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
	s.decideApproval(w, r, "approved")
}

func (s *Server) rejectRun(w http.ResponseWriter, r *http.Request) {
	s.decideApproval(w, r, "rejected")
}

// decideApproval persists the human decision. The execution goroutine (or the
// startup recovery loop) observes it and continues the run, so a decision
// survives a server restart and is never kept only in memory.
func (s *Server) decideApproval(w http.ResponseWriter, r *http.Request, decision string) {
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

	var req struct {
		Reason string
	}
	if decision == "rejected" {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	now := time.Now()
	updates := map[string]interface{}{
		"approval_decision": decision,
		"approved_by":       claims.Username,
		"approved_at":       &now,
	}
	if decision == "rejected" {
		updates["rejected_reason"] = req.Reason
	}
	res := s.DB.DB.Model(&store.Run{}).
		Where("id = ? AND status = ? AND approval_decision = ?", id, "awaiting_approval", "").
		Updates(updates)
	if res.Error != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", res.Error.Error())
		return
	}
	if res.RowsAffected == 0 {
		fail(w, http.StatusConflict, "E_RUN_STATE", "approval already decided")
		return
	}
	if err := s.DB.DB.First(&run, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	action := "approve"
	event := "approval.approved"
	status := "approved"
	if decision == "rejected" {
		action = "reject"
		event = "approval.rejected"
		status = "rejected_approval"
	}
	s.audit(r, action, runTarget(id))
	go s.notifyApproval(&run, event, status)
	ok(w, s.runJSON(run))
}

func runTarget(id uint) string {
	return "run " + strconv.FormatUint(uint64(id), 10)
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
