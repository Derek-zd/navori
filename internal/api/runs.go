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
	agentNames := s.agentNameMap()
	for _, v := range runs {
		out = append(out, s.runJSONWithAgents(v, agentNames))
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

func (s *Server) agentNameMap() map[uint]string {
	names := map[uint]string{}
	var agents []store.Agent
	s.DB.DB.Find(&agents)
	for _, a := range agents {
		names[a.ID] = a.Name
	}
	return names
}

func (s *Server) runJSON(v store.Run) map[string]interface{} {
	return s.runJSONWithAgents(v, s.agentNameMap())
}

func (s *Server) runJSONWithAgents(v store.Run, agentNames map[uint]string) map[string]interface{} {
	var steps []store.Step
	s.DB.DB.Where("run_id = ?", v.ID).Order("step_order").Find(&steps)
	stepOut := make([]map[string]interface{}, 0, len(steps))
	for _, st := range steps {
		out := map[string]interface{}{
			"name": st.Name, "status": st.Status, "startedAt": st.StartedAt, "finishedAt": st.FinishedAt,
			"agentId": st.AgentID, "agentSelector": st.AgentSelector, "attempt": st.Attempt,
		}
		if name, ok := agentNames[st.AgentID]; ok {
			out["agentName"] = name
		}
		stepOut = append(stepOut, out)
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
		"approvalDecision": v.ApprovalDecision,
		"approvedBy":       v.ApprovedBy,
		"approvedAt":       v.ApprovedAt,
		"rejectedReason":   v.RejectedReason,
		"startedAt":        v.StartedAt,
		"finishedAt":       v.FinishedAt,
		"steps":            stepOut,
	}
}
