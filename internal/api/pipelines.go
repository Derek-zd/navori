package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"

	"gorm.io/gorm"

	"navori/internal/agentx"
	"navori/internal/rules"
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
	var cfgMap map[string]interface{}
	if err := json.Unmarshal(cfg, &cfgMap); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid config")
		return
	}
	if err := validateExecution(cfgMap); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", err.Error())
		return
	}
	br := req.BranchRules
	if len(br) == 0 {
		br = []byte("[]")
	}
	nf := req.Notify
	if len(nf) == 0 {
		nf = []byte("{}")
	}
	if err := s.validateBranchRules(br); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", err.Error())
		return
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
		var cfgMap map[string]interface{}
		if err := json.Unmarshal(req.Config, &cfgMap); err != nil {
			fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid config")
			return
		}
		if err := validateExecution(cfgMap); err != nil {
			fail(w, http.StatusBadRequest, "E_VALIDATION", err.Error())
			return
		}
		p.ConfigJSON = string(req.Config)
	}
	if len(req.BranchRules) > 0 {
		if err := s.validateBranchRules(req.BranchRules); err != nil {
			fail(w, http.StatusBadRequest, "E_VALIDATION", err.Error())
			return
		}
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
	var p store.Pipeline
	if err := s.DB.DB.First(&p, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "pipeline not found")
		return
	}
	var active int64
	s.DB.DB.Model(&store.Run{}).
		Where("pipeline_id = ? AND status IN ?", id, []string{"running", "pending", "queued", "awaiting_approval"}).
		Count(&active)
	if active > 0 {
		fail(w, http.StatusConflict, "E_CONFLICT", "pipeline has active runs")
		return
	}
	var runIDs []uint
	s.DB.DB.Model(&store.Run{}).Where("pipeline_id = ?", id).Pluck("id", &runIDs)
	if err := s.DB.DB.Transaction(func(tx *gorm.DB) error {
		if len(runIDs) > 0 {
			if err := tx.Where("run_id IN ?", runIDs).Delete(&store.Step{}).Error; err != nil {
				return err
			}
			if err := tx.Where("id IN ?", runIDs).Delete(&store.Run{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("pipeline_id = ?", id).Delete(&store.WebhookEvent{}).Error; err != nil {
			return err
		}
		return tx.Delete(&store.Pipeline{}, id).Error
	}); err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	for _, runID := range runIDs {
		_ = os.RemoveAll(s.runLogDir(runID))
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

	branch := ""
	ref := ""
	if req.Ref != "" {
		// explicit ref: run exactly that branch (tag or branch)
		ref = req.Ref
		branch = stripRef(req.Ref)
	} else {
		// no ref from the UI: run the branch this pipeline is configured for
		// (first exact branch rule that exists, else the repo default).
		branch = s.pickRunBranch(&p, &repo)
	}
	config := s.configForBranch(&p, branch)
	run, err := s.trigger(&p, &repo, "manual", ref, branch, "", config)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", err.Error())
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

// validateExecution rejects malformed agent selectors early instead of
// queueing steps that no agent can ever match.
func validateExecution(cfg map[string]interface{}) error {
	rc := parseResolvedConfig(cfg)
	if sel := rc.Execution.BuildAgent; sel != "" {
		if _, err := agentx.ParseSelector(sel); err != nil {
			return fmt.Errorf("execution.buildAgent: %w", err)
		}
	}
	if err := validateRelativePath("dockerfilePath", rc.DockerfilePath); err != nil {
		return err
	}
	return validateRelativePath("buildContext", rc.BuildContext)
}

func validateRelativePath(name, value string) error {
	if value == "" {
		return nil
	}
	if strings.HasPrefix(value, "/") || strings.HasPrefix(value, "\\") || (len(value) > 1 && value[1] == ':') {
		return fmt.Errorf("%s must be a relative path", name)
	}
	clean := path.Clean(value)
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return fmt.Errorf("%s must not escape the repository", name)
	}
	return nil
}

func (s *Server) validateBranchRules(raw []byte) error {
	var brs []rules.Rule
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, &brs); err != nil {
		return fmt.Errorf("branchRules: %w", err)
	}
	seen := make(map[string]bool, len(brs))
	for i, r := range brs {
		branch := strings.TrimSpace(r.Branch)
		if branch == "" {
			return fmt.Errorf("branchRules[%d].branch is required", i)
		}
		if seen[branch] {
			return fmt.Errorf("branchRules[%d].branch %q is duplicated", i, branch)
		}
		seen[branch] = true
		if err := validateExecution(r.Overrides); err != nil {
			return fmt.Errorf("branchRules[%d] (%s): %w", i, branch, err)
		}
		deploy, _ := r.Overrides["deploy"].(map[string]interface{})
		if deploy == nil {
			continue
		}
		if v, ok := deploy["targetId"]; ok {
			id, _ := v.(float64)
			if uint(id) > 0 {
				var count int64
				s.DB.DB.Model(&store.DeployTarget{}).Where("id = ?", uint(id)).Count(&count)
				if count == 0 {
					return fmt.Errorf("branchRules[%d] (%s): deploy target %d not found", i, branch, uint(id))
				}
			}
		}
		if name, _ := deploy["name"].(string); name != "" {
			var count int64
			s.DB.DB.Model(&store.DeployTarget{}).Where("name = ?", name).Count(&count)
			if count == 0 {
				return fmt.Errorf("branchRules[%d] (%s): deploy target %q not found", i, branch, name)
			}
		}
	}
	return nil
}
