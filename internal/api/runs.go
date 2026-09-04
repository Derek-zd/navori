package api

import (
	"net/http"

	"navori/internal/store"
)

func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := s.DB.DB.Order("id desc")
	if pid := q.Get("pipelineId"); pid != "" {
		query = query.Where("pipeline_id = ?", pid)
	}
	if st := q.Get("status"); st != "" {
		query = query.Where("status = ?", st)
	}
	var runs []store.Run
	if err := query.Limit(50).Find(&runs).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(runs))
	for _, v := range runs {
		out = append(out, s.runJSON(v))
	}
	ok(w, out)
}

func (s *Server) getRun(w http.ResponseWriter, r *http.Request) {
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
	ok(w, s.runJSON(run))
}

func (s *Server) runJSON(v store.Run) map[string]interface{} {
	var steps []store.Step
	s.DB.DB.Where("run_id = ?", v.ID).Order("step_order").Find(&steps)
	stepOut := make([]map[string]interface{}, 0, len(steps))
	for _, st := range steps {
		stepOut = append(stepOut, map[string]interface{}{
			"name": st.Name, "status": st.Status, "startedAt": st.StartedAt, "finishedAt": st.FinishedAt,
		})
	}
	commitShort := v.Commit
	if len(commitShort) > 7 {
		commitShort = commitShort[:7]
	}
	return map[string]interface{}{
		"id":               v.ID,
		"pipelineId":       v.PipelineID,
		"number":           v.Number,
		"triggerType":      v.TriggerType,
		"ref":              v.Ref,
		"commit":           v.Commit,
		"commitShort":      commitShort,
		"status":           v.Status,
		"imageTag":         v.ImageTag,
		"error":            v.Error,
		"approvalRequired": v.ApprovalRequired,
		"approvedBy":       v.ApprovedBy,
		"approvedAt":       v.ApprovedAt,
		"rejectedReason":   v.RejectedReason,
		"startedAt":        v.StartedAt,
		"finishedAt":       v.FinishedAt,
		"steps":            stepOut,
	}
}
