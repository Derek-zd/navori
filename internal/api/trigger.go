package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"navori/internal/gitx"
	"navori/internal/rules"
	"navori/internal/store"
)

func (s *Server) repoDir(repoID uint) string {
	return filepath.Join(s.Cfg.DataDir, "repos", strconv.FormatUint(uint64(repoID), 10))
}

// resolveForBranch returns the effective config and whether branch triggers.
func (s *Server) resolveForBranch(p *store.Pipeline, repo *store.Repository, branch string) (map[string]interface{}, bool) {
	var defaults map[string]interface{}
	_ = json.Unmarshal([]byte(p.ConfigJSON), &defaults)
	if defaults == nil {
		defaults = map[string]interface{}{}
	}
	var brs []rules.Rule
	_ = json.Unmarshal([]byte(p.BranchRulesJSON), &brs)
	if len(brs) == 0 {
		if branch == "" || branch == repo.DefaultBranch {
			return defaults, true
		}
		return nil, false
	}
	cfg, ok := rules.Resolve(defaults, brs, branch)
	return cfg, ok
}

// trigger creates a run with pull/build/push steps and executes them asynchronously.
func (s *Server) trigger(p *store.Pipeline, repo *store.Repository, triggerType, ref, branch, commit string, config map[string]interface{}) (*store.Run, error) {
	now := time.Now()
	cfgJSON, _ := json.Marshal(config)
	run := store.Run{
		PipelineID:         p.ID,
		Number:             nextRunNumber(s.DB.DB, p.ID),
		TriggerType:        triggerType,
		Ref:                ref,
		Commit:             commit,
		Status:             "running",
		ConfigSnapshotJSON: string(cfgJSON),
		StartedAt:          &now,
	}
	if err := s.DB.DB.Create(&run).Error; err != nil {
		return nil, err
	}
	rc := parseResolvedConfig(config)
	stepNames := []string{"pull", "build", "push"}
	if rc.Deploy.TargetID != 0 || rc.Deploy.Name != "" {
		if rc.Deploy.Approval {
			stepNames = append(stepNames, "approve")
		}
		stepNames = append(stepNames, "deploy")
	}
	for i, name := range stepNames {
		step := store.Step{RunID: run.ID, StepOrder: i + 1, Name: name, Status: "pending"}
		if err := s.DB.DB.Create(&step).Error; err != nil {
			return nil, err
		}
	}
	go s.executeRun(&run, repo, branch, config)
	s.gcRuns(p.ID, s.Cfg.RunRetention)
	return &run, nil
}

// triggerWebhook creates a run unless the commit was already processed (dedup).
func (s *Server) triggerWebhook(p *store.Pipeline, repo *store.Repository, ref, branch, commit string, config map[string]interface{}) (*store.Run, bool, error) {
	digest := strconv.FormatUint(uint64(p.ID), 10) + ":" + commit
	ev := store.WebhookEvent{PipelineID: p.ID, PayloadDigest: digest}
	if err := s.DB.DB.Create(&ev).Error; err != nil {
		return nil, true, nil
	}
	run, err := s.trigger(p, repo, "webhook", ref, branch, commit, config)
	return run, false, err
}

func (s *Server) doScan(repo *store.Repository) {
	dir := s.repoDir(repo.ID)
	url := s.cloneURL(repo)
	var err error
	if _, statErr := os.Stat(filepath.Join(dir, ".git")); statErr != nil {
		err = gitx.Clone(dir, url, repo.DefaultBranch)
		if err != nil && repo.DefaultBranch != "" {
			_ = os.RemoveAll(dir)
			err = gitx.Clone(dir, url, "")
		}
	} else {
		err = gitx.Pull(dir)
	}
	if err != nil {
		s.DB.DB.Model(repo).Updates(map[string]interface{}{"scan_status": "error", "scan_message": err.Error()})
		return
	}
	if branch, berr := gitx.DefaultBranch(dir); berr == nil && branch != "" && branch != repo.DefaultBranch {
		repo.DefaultBranch = branch
		s.DB.DB.Model(repo).Update("default_branch", branch)
	}
	path, err := gitx.FindDockerfile(dir)
	if err != nil {
		s.DB.DB.Model(repo).Updates(map[string]interface{}{"scan_status": "error", "scan_message": err.Error()})
		return
	}
	updates := map[string]interface{}{"scan_status": "done", "scan_message": path}
	if repo.DockerfilePath == "" || repo.DockerfilePath == "Dockerfile" {
		updates["dockerfile_path"] = path
	}
	s.DB.DB.Model(repo).Updates(updates)
}

func (s *Server) cloneURL(repo *store.Repository) string {
	url := repo.GitURL
	if repo.CredentialID != 0 {
		var cred store.GitCredential
		if s.DB.DB.First(&cred, repo.CredentialID).Error == nil {
			if secret, err := s.Sec.Decrypt(cred.SecretEnc); err == nil && secret != "" && cred.Type == "https" {
				url = embedToken(url, cred.Username, secret)
			}
		}
	}
	return url
}

func embedToken(url, username, secret string) string {
	if i := strings.Index(url, "://"); i >= 0 {
		return url[:i+3] + username + ":" + secret + "@" + url[i+3:]
	}
	return url
}

func nextRunNumber(db *gorm.DB, pipelineID uint) int {
	var max int
	db.Model(&store.Run{}).Where("pipeline_id = ?", pipelineID).Select("COALESCE(MAX(number), 0)").Scan(&max)
	return max + 1
}
