package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"

	"navori/internal/store"
)

func (s *Server) listPipelines(w http.ResponseWriter, r *http.Request) {
	var ps []store.Pipeline
	if err := s.DB.DB.Order("id desc").Find(&ps).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(ps))
	for _, p := range ps {
		out = append(out, s.pipelineJSON(p))
	}
	ok(w, out)
}

func (s *Server) createPipeline(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoID      uint
		Config      json.RawMessage
		BranchRules json.RawMessage
		Notify      json.RawMessage
		Group       string
		Schedule    string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.RepoID == 0 {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "repoId is required")
		return
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, req.RepoID).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "repository not found")
		return
	}
	// one repo = one pipeline
	var count int64
	s.DB.DB.Model(&store.Pipeline{}).Where("repo_id = ?", req.RepoID).Count(&count)
	if count > 0 {
		fail(w, http.StatusConflict, "E_CONFLICT", "pipeline already exists for this repository")
		return
	}
	cfg := req.Config
	if len(cfg) == 0 {
		cfg = []byte("{}")
	}
	br := req.BranchRules
	if len(br) == 0 {
		br = []byte("[]")
	}
	nf := req.Notify
	if len(nf) == 0 {
		nf = []byte("{}")
	}
	token, err := randomHex(16)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	p := store.Pipeline{
		RepoID:          req.RepoID,
		ConfigJSON:      string(cfg),
		BranchRulesJSON: string(br),
		NotifyJSON:      string(nf),
		WebhookToken:    token,
		Group:           req.Group,
		Schedule:        req.Schedule,
	}
	if err := s.DB.DB.Create(&p).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "pipeline.create", strconv.FormatUint(uint64(p.ID), 10))
	created(w, s.pipelineJSON(p))
}

func (s *Server) getPipeline(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var p store.Pipeline
	if err := s.DB.DB.First(&p, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "pipeline not found")
		return
	}
	ok(w, s.pipelineJSON(p))
}

func (s *Server) updatePipeline(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var p store.Pipeline
	if err := s.DB.DB.First(&p, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "pipeline not found")
		return
	}
	var req struct {
		Config      json.RawMessage
		BranchRules json.RawMessage
		Notify      json.RawMessage
		Group       *string
		Schedule    *string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if len(req.Config) > 0 {
		p.ConfigJSON = string(req.Config)
	}
	if len(req.BranchRules) > 0 {
		p.BranchRulesJSON = string(req.BranchRules)
	}
	if len(req.Notify) > 0 {
		p.NotifyJSON = string(req.Notify)
	}
	if req.Group != nil {
		p.Group = *req.Group
	}
	if req.Schedule != nil {
		p.Schedule = *req.Schedule
	}
	if err := s.DB.DB.Save(&p).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "pipeline.update", strconv.FormatUint(uint64(p.ID), 10))
	ok(w, s.pipelineJSON(p))
}

func (s *Server) deletePipeline(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	if err := s.DB.DB.Delete(&store.Pipeline{}, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "pipeline.delete", strconv.FormatUint(uint64(id), 10))
	ok(w, map[string]interface{}{})
}

func (s *Server) runPipeline(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var p store.Pipeline
	if err := s.DB.DB.First(&p, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "pipeline not found")
		return
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, p.RepoID).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "repository not found")
		return
	}
	var req struct {
		Ref string
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	branch := repo.DefaultBranch
	ref := ""
	if req.Ref != "" {
		ref = req.Ref
		branch = stripRef(req.Ref)
	}
	config, ok := s.resolveForBranch(&p, &repo, branch)
	if !ok {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "branch not allowed by rules")
		return
	}
	run, err := s.trigger(&p, &repo, "manual", ref, branch, "", config)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]interface{}{"data": map[string]interface{}{"runId": run.ID, "number": run.Number}})
}

func (s *Server) pipelineJSON(p store.Pipeline) map[string]interface{} {
	var config, branchRules, notify interface{}
	_ = json.Unmarshal([]byte(p.ConfigJSON), &config)
	_ = json.Unmarshal([]byte(p.BranchRulesJSON), &branchRules)
	_ = json.Unmarshal([]byte(p.NotifyJSON), &notify)
	var lastRun *store.Run
	s.DB.DB.Where("pipeline_id = ?", p.ID).Order("id desc").First(&lastRun)
	var lastRunJSON interface{}
	if lastRun != nil && lastRun.ID != 0 {
		commitShort := lastRun.Commit
		if len(commitShort) > 7 {
			commitShort = commitShort[:7]
		}
		lastRunJSON = map[string]interface{}{
			"runId":       lastRun.ID,
			"number":      lastRun.Number,
			"status":      lastRun.Status,
			"triggerType": lastRun.TriggerType,
			"ref":         lastRun.Ref,
			"commitShort": commitShort,
			"imageTag":    lastRun.ImageTag,
			"startedAt":   lastRun.StartedAt,
			"finishedAt":  lastRun.FinishedAt,
		}
	}
	return map[string]interface{}{
		"id":          p.ID,
		"repoId":      p.RepoID,
		"config":      config,
		"branchRules": branchRules,
		"notify":      notify,
		"webhookUrl":  s.Cfg.BaseURL + "/api/webhooks?token=" + p.WebhookToken,
		"lastRun":     lastRunJSON,
		"group":       p.Group,
		"schedule":    p.Schedule,
		"createdAt":   p.CreatedAt,
		"updatedAt":   p.UpdatedAt,
	}
}
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
