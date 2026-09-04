package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"navori/internal/store"
)

func (s *Server) stopRun(w http.ResponseWriter, r *http.Request) {
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
	if s.cancelRun(id) {
		s.audit(r, "run.stop", strconv.FormatUint(uint64(id), 10))
		ok(w, map[string]interface{}{"status": "cancelling"})
		return
	}
	fail(w, http.StatusConflict, "E_RUN_STATE", "run is not running")
}

func (s *Server) rerunRun(w http.ResponseWriter, r *http.Request) {
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
	var pipeline store.Pipeline
	if err := s.DB.DB.First(&pipeline, run.PipelineID).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "pipeline not found")
		return
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, pipeline.RepoID).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "repository not found")
		return
	}
	var config map[string]interface{}
	_ = json.Unmarshal([]byte(run.ConfigSnapshotJSON), &config)
	branch := stripRef(run.Ref)
	newRun, err := s.trigger(&pipeline, &repo, "rerun", run.Ref, branch, run.Commit, config)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "run.rerun", strconv.FormatUint(uint64(id), 10))
	writeJSON(w, http.StatusAccepted, map[string]interface{}{"data": map[string]interface{}{"runId": newRun.ID, "number": newRun.Number}})
}
