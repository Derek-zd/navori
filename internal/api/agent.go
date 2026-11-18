package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"navori/internal/agentx"
	"navori/internal/store"
)

const (
	agentKey ctxKey = "agent"

	agentOfflineAfter = 45 * time.Second
	agentJanitorEvery = 15 * time.Second
	agentLease        = agentx.DefaultLeaseSeconds * time.Second
)

// requireAgent authenticates an executor with a Bearer token. This is kept
// completely separate from the user JWT middleware.
func (s *Server) requireAgent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		const prefix = "Bearer "
		if !strings.HasPrefix(header, prefix) {
			fail(w, http.StatusUnauthorized, "E_AUTH", "missing agent token")
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
		if token == "" {
			fail(w, http.StatusUnauthorized, "E_AUTH", "missing agent token")
			return
		}
		sum := sha256.Sum256([]byte(token))
		var a store.Agent
		if err := s.DB.DB.Where("token_hash = ?", hex.EncodeToString(sum[:])).First(&a).Error; err != nil {
			fail(w, http.StatusUnauthorized, "E_AUTH", "invalid agent token")
			return
		}
		if a.Status == "disabled" {
			fail(w, http.StatusUnauthorized, "E_AUTH", "agent is disabled")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), agentKey, &a)))
	})
}

func agentFrom(r *http.Request) *store.Agent {
	a, _ := r.Context().Value(agentKey).(*store.Agent)
	return a
}

// agentHello updates liveness and returns protocol limits. Registered labels
// are authoritative; labels reported by the agent are ignored for routing.
func (s *Server) agentHello(w http.ResponseWriter, r *http.Request) {
	a := agentFrom(r)
	var req agentx.HelloReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Protocol != 0 && req.Protocol != agentx.Protocol {
		fail(w, http.StatusUpgradeRequired, "E_PROTOCOL", "unsupported agent protocol")
		return
	}
	if req.Name != a.Name {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "agent name mismatch")
		return
	}
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":       "online",
		"version":      trimLimit(req.Version, 32),
		"hostname":     trimLimit(req.Host, 128),
		"protocol":     agentx.Protocol,
		"last_seen_at": now,
		"last_seen_ip": remoteIP(r),
	}
	if err := s.DB.DB.Model(&store.Agent{}).Where("id = ?", a.ID).Updates(updates).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	log.Printf("agent %q connected (version=%s host=%s)", a.Name, req.Version, req.Host)
	writeJSON(w, http.StatusOK, agentx.HelloResp{
		Protocol:         agentx.Protocol,
		ServerVersion:    s.Cfg.Version,
		HeartbeatSeconds: agentx.DefaultHeartbeatSeconds,
		ClaimWaitSeconds: agentx.DefaultClaimWaitSeconds,
		MaxStepSeconds:   agentx.DefaultMaxStepSeconds,
		Now:              now,
	})
}

// agentHeartbeat refreshes liveness and every running lease owned by the
// agent, and returns steps the agent should cancel.
func (s *Server) agentHeartbeat(w http.ResponseWriter, r *http.Request) {
	a := agentFrom(r)
	var req agentx.HeartbeatReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":       "online",
		"last_seen_at": now,
		"last_seen_ip": remoteIP(r),
	}
	if req.Version != "" {
		updates["version"] = trimLimit(req.Version, 32)
	}
	if err := s.DB.DB.Model(&store.Agent{}).Where("id = ?", a.ID).Updates(updates).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	if err := s.DB.DB.Model(&store.Step{}).
		Where("agent_id = ? AND status = ?", a.ID, "running").
		Update("lease_expires_at", now.Add(agentLease)).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	// Cancellation delivery is wired up with the dispatcher (P3); until a
	// step can be handed out there is nothing to cancel.
	writeJSON(w, http.StatusOK, agentx.HeartbeatResp{OK: true, Cancel: []uint{}})
}

// agentClaim returns a queued step that matches the agent's labels. The
// skeleton does not dispatch yet, so it always answers 204.
func (s *Server) agentClaim(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

// StartAgentJanitor marks agents that stopped heartbeating as offline. It
// runs once immediately so agents left online by a previous server process
// become offline promptly.
func (s *Server) StartAgentJanitor(ctx context.Context) {
	go func() {
		s.markStaleAgentsOffline()
		t := time.NewTicker(agentJanitorEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.markStaleAgentsOffline()
			}
		}
	}()
}

func (s *Server) markStaleAgentsOffline() {
	cutoff := time.Now().UTC().Add(-agentOfflineAfter)
	if err := s.DB.DB.Model(&store.Agent{}).
		Where("status = ? AND (last_seen_at IS NULL OR last_seen_at < ?)", "online", cutoff).
		Update("status", "offline").Error; err != nil {
		log.Printf("agent janitor: %v", err)
	}
}

func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return trimLimit(r.RemoteAddr, 64)
	}
	return trimLimit(host, 64)
}

func trimLimit(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
