package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"navori/internal/agentx"
	"navori/internal/store"
)

func (s *Server) listAgents(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	var agents []store.Agent
	if err := s.DB.DB.Order("id desc").Find(&agents).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(agents))
	for _, a := range agents {
		out = append(out, agentJSON(a))
	}
	ok(w, out)
}

func (s *Server) createAgent(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	var req struct {
		Name   string `json:"name"`
		Labels string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 64 {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "name is required (max 64 bytes)")
		return
	}
	labels, err := agentx.NormalizeLabels(req.Labels)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", err.Error())
		return
	}
	token, hash, err := newAgentToken()
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	a := store.Agent{
		Name:      req.Name,
		Labels:    labels,
		TokenHash: hash,
		Status:    "offline",
		Protocol:  agentx.Protocol,
	}
	if err := s.DB.DB.Create(&a).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "agent.register", a.Name)
	created(w, map[string]interface{}{"agent": agentJSON(a), "token": token})
}

func (s *Server) updateAgent(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var a store.Agent
	if err := s.DB.DB.First(&a, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "agent not found")
		return
	}
	var req struct {
		Labels   *string `json:"labels"`
		Disabled *bool   `json:"disabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Labels != nil {
		labels, err := agentx.NormalizeLabels(*req.Labels)
		if err != nil {
			fail(w, http.StatusBadRequest, "E_VALIDATION", err.Error())
			return
		}
		a.Labels = labels
	}
	action := "agent.update"
	if req.Disabled != nil {
		if *req.Disabled {
			a.Status = "disabled"
			action = "agent.disable"
		} else if a.Status == "disabled" {
			// The next heartbeat flips it back to online.
			a.Status = "offline"
			action = "agent.enable"
		}
	}
	if err := s.DB.DB.Save(&a).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, action, a.Name)
	ok(w, agentJSON(a))
}

func (s *Server) rotateAgentToken(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var a store.Agent
	if err := s.DB.DB.First(&a, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "agent not found")
		return
	}
	token, hash, err := newAgentToken()
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	a.TokenHash = hash
	if err := s.DB.DB.Save(&a).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "agent.rotate", a.Name)
	ok(w, map[string]string{"token": token})
}

func (s *Server) deleteAgent(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var a store.Agent
	if err := s.DB.DB.First(&a, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "agent not found")
		return
	}
	if err := s.DB.DB.Delete(&a).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "agent.delete", a.Name)
	ok(w, map[string]interface{}{})
}

func agentJSON(a store.Agent) map[string]interface{} {
	return map[string]interface{}{
		"id":         a.ID,
		"name":       a.Name,
		"labels":     a.Labels,
		"status":     a.Status,
		"version":    a.Version,
		"protocol":   a.Protocol,
		"hostname":   a.Hostname,
		"lastSeenAt": a.LastSeenAt,
		"lastSeenIp": a.LastSeenIP,
		"createdAt":  a.CreatedAt,
	}
}

func newAgentToken() (token, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(sum[:]), nil
}
