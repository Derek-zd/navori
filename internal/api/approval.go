package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"navori/internal/auth"
	"navori/internal/store"
)

func (s *Server) approveRun(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var run store.Run
	if err := s.DB.DB.First(&run, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "run not found")
		return
	}
	if run.Status != "awaiting_approval" {
		fail(w, http.StatusConflict, "E_RUN_STATE", "run is not awaiting approval")
		return
	}
	claims := claimsFrom(r)
	if !s.canApprove(&run, claims) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "not allowed to approve")
		return
	}
	now := time.Now()
	s.DB.DB.Model(&run).Updates(map[string]interface{}{"approved_by": claims.Username, "approved_at": &now})
	if !s.decideRun(id, "approve") {
		fail(w, http.StatusConflict, "E_RUN_STATE", "no pending approval")
		return
	}
	s.audit(r, "approve", runTarget(id))
	go s.notifyApproval(&run, "approval.approved", "approved")
	ok(w, s.runJSON(run))
}
func (s *Server) rejectRun(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var run store.Run
	if err := s.DB.DB.First(&run, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "run not found")
		return
	}
	if run.Status != "awaiting_approval" {
		fail(w, http.StatusConflict, "E_RUN_STATE", "run is not awaiting approval")
		return
	}
	claims := claimsFrom(r)
	if !s.canApprove(&run, claims) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "not allowed to approve")
		return
	}
	now := time.Now()
	var req struct {
		Reason string
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	s.DB.DB.Model(&run).Updates(map[string]interface{}{"approved_by": claims.Username, "approved_at": &now, "rejected_reason": req.Reason})
	if !s.decideRun(id, "reject") {
		fail(w, http.StatusConflict, "E_RUN_STATE", "no pending approval")
		return
	}
	s.audit(r, "reject", runTarget(id))
	go s.notifyApproval(&run, "approval.rejected", "rejected_approval")
	ok(w, s.runJSON(run))
}
func runTarget(id uint) string {
	return "run " + strconv.FormatUint(uint64(id), 10)
}

func (s *Server) decideRun(id uint, decision string) bool {
	s.approveMu.Lock()
	ch, ok := s.approveChans[id]
	s.approveMu.Unlock()
	if !ok {
		return false
	}
	ch <- decision
	return true
}

func (s *Server) canApprove(run *store.Run, claims *auth.Claims) bool {
	if claims.Role == "admin" {
		return true
	}
	var config map[string]interface{}
	_ = json.Unmarshal([]byte(run.ConfigSnapshotJSON), &config)
	deploy, _ := config["deploy"].(map[string]interface{})
	if deploy == nil {
		return false
	}
	approvers, _ := deploy["approvers"].([]interface{})
	for _, a := range approvers {
		if name, ok := a.(string); ok && name == claims.Username {
			return true
		}
	}
	return false
}
