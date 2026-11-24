package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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
	now := time.Now().UTC()
	wasOnline := a.Status == "online"
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
	if !wasOnline {
		cur := *a
		cur.Status = "online"
		cur.Version = trimLimit(req.Version, 32)
		cur.Hostname = trimLimit(req.Host, 128)
		cur.LastSeenAt = &now
		go s.notifyAgentStatus(&cur, "online")
	}
	writeJSON(w, http.StatusOK, agentx.HelloResp{
		Protocol:         agentx.Protocol,
		Name:             a.Name,
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
	wasOnline := a.Status == "online"
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
	if !wasOnline {
		cur := *a
		cur.Status = "online"
		cur.LastSeenAt = &now
		if req.Version != "" {
			cur.Version = trimLimit(req.Version, 32)
		}
		go s.notifyAgentStatus(&cur, "online")
	}
	if err := s.DB.DB.Model(&store.Step{}).
		Where("agent_id = ? AND status = ?", a.ID, "running").
		Update("lease_expires_at", now.Add(agentLease)).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	// Tell the agent to kill jobs that were cancelled, failed, or requeued to
	// another agent. The agent sends its running list, so this is exact.
	cancel := []uint{}
	for _, rs := range req.Running {
		var st store.Step
		if err := s.DB.DB.First(&st, rs.StepID).Error; err != nil {
			continue
		}
		if st.AgentID != a.ID || st.Status == "cancelled" || st.Status == "failed" {
			cancel = append(cancel, rs.StepID)
		}
	}
	writeJSON(w, http.StatusOK, agentx.HeartbeatResp{OK: true, Cancel: cancel})
}

// agentClaim long-polls for a queued step that matches this agent's labels.
// It holds the request for up to claimWaitSeconds (25s).
func (s *Server) agentClaim(w http.ResponseWriter, r *http.Request) {
	a := agentFrom(r)
	deadline := time.Now().Add(time.Duration(agentx.DefaultClaimWaitSeconds) * time.Second)
	for {
		job, found, err := s.claimStep(a)
		if err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
		if found {
			writeJSON(w, http.StatusOK, job)
			return
		}
		if time.Now().After(deadline) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}

const agentLogMaxBytes = 20 << 20

// agentJobLog appends a batch of log lines to the step's log file. The
// existing SSE handler tails that file, so the UI is unchanged.
func (s *Server) agentJobLog(w http.ResponseWriter, r *http.Request) {
	a := agentFrom(r)
	stepID, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid job id")
		return
	}
	var step store.Step
	if err := s.DB.DB.First(&step, stepID).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "job not found")
		return
	}
	if step.AgentID != a.ID {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "job not assigned to this agent")
		return
	}
	if isTerminalStep(step.Status) {
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "ignored": true})
		return
	}
	if step.Status != "running" {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "job not assigned to this agent")
		return
	}

	var req agentx.LogChunk
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	path := step.LogFile
	if path == "" {
		path = filepath.Join(s.runLogDir(step.RunID), step.Name+".log")
	}
	if info, err := os.Stat(path); err == nil && info.Size() >= agentLogMaxBytes {
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "truncated": true})
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	defer f.Close()
	for _, line := range req.Lines {
		if len(line) > 8192 {
			line = line[:8192]
		}
		if _, err := f.WriteString(line + "\n"); err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
	}
	now := time.Now().UTC()
	s.DB.DB.Model(&store.Step{}).
		Where("id = ? AND agent_id = ? AND status = ?", step.ID, a.ID, "running").
		Update("lease_expires_at", now.Add(agentLease))
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

// agentJobResult records the terminal status of a claimed step. It is
// idempotent: a step that is already terminal is accepted and ignored.
func (s *Server) agentJobResult(w http.ResponseWriter, r *http.Request) {
	a := agentFrom(r)
	stepID, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid job id")
		return
	}
	var req agentx.ResultReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Status != "success" && req.Status != "failed" && req.Status != "cancelled" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid status")
		return
	}
	var step store.Step
	if err := s.DB.DB.First(&step, stepID).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "job not found")
		return
	}
	if step.AgentID != a.ID {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "job not assigned to this agent")
		return
	}
	if isTerminalStep(step.Status) {
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "ignored": true})
		return
	}
	res := s.DB.DB.Model(&store.Step{}).
		Where("id = ? AND agent_id = ? AND status IN ?", step.ID, a.ID, []string{"queued", "running"}).
		Updates(map[string]interface{}{"status": req.Status, "finished_at": time.Now().UTC()})
	if res.Error != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", res.Error.Error())
		return
	}
	if res.RowsAffected > 0 {
		log.Printf("step.result run=%d step=%d name=%s agent=%q status=%s", step.RunID, step.ID, step.Name, a.Name, req.Status)
		s.DB.DB.Create(&store.AuditLog{Action: "step.result", Target: strconv.FormatUint(uint64(step.ID), 10)})
		s.notifyStep(step.ID, stepResult{Status: req.Status, Error: req.Error})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func isTerminalStep(status string) bool {
	switch status {
	case "success", "failed", "skipped", "cancelled", "rejected":
		return true
	}
	return false
}

// StartAgentJanitor marks agents that stopped heartbeating as offline. It
// runs once immediately so agents left online by a previous server process
// become offline promptly.
func (s *Server) StartAgentJanitor(ctx context.Context) {
	go func() {
		// Do not alert on the initial sweep: agents from the previous server
		// process are expected to reconnect within the offline grace period.
		s.markStaleAgentsOffline(false)
		s.expireStepLeases()
		t := time.NewTicker(agentJanitorEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.markStaleAgentsOffline(true)
				s.expireStepLeases()
			}
		}
	}()
}

func (s *Server) markStaleAgentsOffline(notify bool) {
	cutoff := time.Now().UTC().Add(-agentOfflineAfter)
	var agents []store.Agent
	if err := s.DB.DB.
		Where("status = ? AND (last_seen_at IS NULL OR last_seen_at < ?)", "online", cutoff).
		Find(&agents).Error; err != nil {
		log.Printf("agent janitor: %v", err)
		return
	}
	for i := range agents {
		res := s.DB.DB.Model(&store.Agent{}).
			Where("id = ? AND status = ?", agents[i].ID, "online").
			Update("status", "offline")
		if res.Error != nil {
			log.Printf("agent janitor: mark %q offline: %v", agents[i].Name, res.Error)
			continue
		}
		if res.RowsAffected == 0 {
			continue
		}
		log.Printf("agent %q marked offline (last seen %s)", agents[i].Name, timeStr(agents[i].LastSeenAt))
		if notify {
			go s.notifyAgentStatus(&agents[i], "offline")
		}
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
