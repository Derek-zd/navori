package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"navori/internal/agentx"
	"navori/internal/gitx"
	"navori/internal/rules"
	"navori/internal/store"
)

func (s *Server) repoDir(repoID uint) string {
	return filepath.Join(s.Cfg.DataDir, "repos", strconv.FormatUint(uint64(repoID), 10))
}

// runRepoDir isolates concurrent runs of the same repository. The base repoDir
// is still used for metadata scans and as a backwards-compatible cache.
func (s *Server) runRepoDir(runID, repoID uint) string {
	return filepath.Join(s.repoDir(repoID), "runs", strconv.FormatUint(uint64(runID), 10))
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

// configForBranch returns the effective config for a run on branch. Unlike
// resolveForBranch it never "rejects": a matching rule's overrides are merged
// over defaults when the branch hits a rule; otherwise plain defaults are
// returned. This is the right behaviour for manual/cron runs — the user asked
// to run the pipeline, so the run proceeds with the base config even if no
// rule matches the branch. (Webhook keep using resolveForBranch, where a
// non-matching branch means "this push is not for this pipeline".)
func (s *Server) configForBranch(p *store.Pipeline, branch string) map[string]interface{} {
	var defaults map[string]interface{}
	_ = json.Unmarshal([]byte(p.ConfigJSON), &defaults)
	if defaults == nil {
		defaults = map[string]interface{}{}
	}
	var brs []rules.Rule
	_ = json.Unmarshal([]byte(p.BranchRulesJSON), &brs)
	if cfg, ok := rules.Resolve(defaults, brs, branch); ok {
		return cfg
	}
	return defaults
}

// pickRunBranch decides which branch a manual/cron run (no explicit ref)
// targets. The pipeline's stored branch rules define what the pipeline runs:
// the first exact branch in the rules that actually exists on the remote wins
// (e.g. a rule of "main" makes the pipeline run main even if the repository's
// default branch is "master"). When rules are empty or only globs, the remote
// default branch is used.
func (s *Server) pickRunBranch(p *store.Pipeline, repo *store.Repository) string {
	var brs []rules.Rule
	_ = json.Unmarshal([]byte(p.BranchRulesJSON), &brs)
	url := s.cloneURL(repo)
	branchCache := map[string]bool{}
	exists := func(b string) bool {
		if v, ok := branchCache[b]; ok {
			return v
		}
		ok, err := gitx.BranchExists(url, b)
		v := err == nil && ok
		branchCache[b] = v
		return v
	}
	if b := rules.PickExactBranch(brs, exists); b != "" {
		return b
	}
	return s.resolveDefaultBranch(repo)
}

// resolveDefaultBranch returns the remote's actual default branch, self-healing
// a stale stored value (repos created before auto-detection may carry a
// hard-coded "main" even though the remote default is e.g. "master"). Callers
// that target the default branch (manual run without ref, cron) use this BEFORE
// matching branch rules, so rules and the branch actually pulled stay in sync.
type cachedBranch struct {
	value string
	at    time.Time
}

const defaultBranchTTL = 30 * time.Second

func (s *Server) resolveDefaultBranch(repo *store.Repository) string {
	s.branchMu.Lock()
	if c, ok := s.branchCache[repo.ID]; ok && c.value != "" && time.Since(c.at) < defaultBranchTTL {
		s.branchMu.Unlock()
		return c.value
	}
	s.branchMu.Unlock()
	if b, err := gitx.RemoteDefaultBranch(s.cloneURL(repo)); err == nil && b != "" {
		if b != repo.DefaultBranch {
			repo.DefaultBranch = b
			s.DB.DB.Model(repo).Update("default_branch", b)
		}
		s.branchMu.Lock()
		if s.branchCache == nil {
			s.branchCache = map[uint]cachedBranch{}
		}
		s.branchCache[repo.ID] = cachedBranch{value: b, at: time.Now()}
		s.branchMu.Unlock()
		return b
	}
	if repo.DefaultBranch == "" {
		return "main" // fallback when remote can't be queried and nothing stored
	}
	return repo.DefaultBranch
}

// trigger creates a run with pull/build/push steps and executes them asynchronously.
func (s *Server) trigger(p *store.Pipeline, repo *store.Repository, triggerType, ref, branch, commit string, config map[string]interface{}) (*store.Run, error) {
	// Safety net: an empty branch (shouldn't normally happen since callers
	// resolve the default branch first) falls back to the remote default.
	// Explicit branches (webhook event branch, ref-specified manual runs) are
	// never overridden here.
	if branch == "" {
		branch = s.resolveDefaultBranch(repo)
	}
	// Store a concrete ref so run lists / notifications / reruns always show
	// which branch ran: manual & cron triggers have no incoming ref, so derive
	// refs/heads/<branch> from the resolved branch (webhook refs already carry
	// the full ref).
	ref = normalizeRef(ref, branch)
	if commit == "" {
		sha, err := gitx.RemoteAnyRefHead(s.cloneURL(repo), ref, branch)
		if err != nil {
			return nil, fmt.Errorf("resolve commit for %s: %w", ref, err)
		}
		commit = sha
	}
	if err := validateExecution(config); err != nil {
		return nil, err
	}
	rc := parseResolvedConfig(config)
	deployAgentID, err := s.deployAgentForConfig(rc)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	cfgJSON, _ := json.Marshal(config)
	stepNames := []string{"pull", "build", "push"}
	if rc.Deploy.TargetID != 0 || rc.Deploy.Name != "" {
		if rc.Deploy.Approval {
			stepNames = append(stepNames, "approve")
		}
		stepNames = append(stepNames, "deploy")
	}
	var run store.Run
	for attempt := 0; attempt < 3; attempt++ {
		err := s.DB.DB.Transaction(func(tx *gorm.DB) error {
			run = store.Run{
				PipelineID:         p.ID,
				Number:             nextRunNumber(tx, p.ID),
				TriggerType:        triggerType,
				Ref:                ref,
				Commit:             commit,
				Status:             "running",
				ConfigSnapshotJSON: string(cfgJSON),
				ApprovalRequired:   (rc.Deploy.TargetID != 0 || rc.Deploy.Name != "") && rc.Deploy.Approval,
				StartedAt:          &now,
			}
			if err := tx.Create(&run).Error; err != nil {
				return err
			}
			for i, name := range stepNames {
				selector := ""
				switch name {
				case "pull", "build", "push":
					selector = rc.Execution.BuildAgent
				case "deploy":
					if deployAgentID > 0 {
						selector = agentx.AgentSelector(deployAgentID)
					}
				}
				step := store.Step{RunID: run.ID, StepOrder: i + 1, Name: name, Status: "pending", AgentSelector: selector}
				if err := tx.Create(&step).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err == nil {
			break
		}
		if !isDuplicateError(err) || attempt == 2 {
			return nil, err
		}
	}
	s.runWG.Add(1)
	go func() {
		defer s.runWG.Done()
		s.executeRun(&run, repo, branch, config)
	}()
	s.gcRuns(p.ID, s.Cfg.RunRetention)
	return &run, nil
}

// deployAgentForConfig resolves the executor bound to the pipeline's deploy
// target. A missing or disabled bound agent fails the trigger instead of
// silently falling back to the server, which would be wrong for a private
// cluster that only the agent can reach.
func (s *Server) deployAgentForConfig(rc resolvedConfig) (uint, error) {
	if rc.Deploy.TargetID == 0 && rc.Deploy.Name == "" {
		return 0, nil
	}
	var dt store.DeployTarget
	q := s.DB.DB
	if rc.Deploy.TargetID > 0 {
		q = q.Where("id = ?", rc.Deploy.TargetID)
	} else {
		q = q.Where("name = ?", rc.Deploy.Name)
	}
	if err := q.First(&dt).Error; err != nil {
		return 0, fmt.Errorf("deploy target %q not found", rc.Deploy.Name)
	}
	if dt.AgentID == 0 {
		return 0, nil
	}
	var a store.Agent
	if err := s.DB.DB.First(&a, dt.AgentID).Error; err != nil {
		return 0, fmt.Errorf("deploy target %q is bound to a missing agent", dt.Name)
	}
	if a.Status == "disabled" {
		return 0, fmt.Errorf("deploy target %q is bound to disabled agent %q", dt.Name, a.Name)
	}
	return a.ID, nil
}

// triggerWebhook creates a run unless the commit was already processed (dedup).
func (s *Server) triggerWebhook(p *store.Pipeline, repo *store.Repository, ref, branch, commit string, config map[string]interface{}) (*store.Run, bool, error) {
	digest := strconv.FormatUint(uint64(p.ID), 10) + ":" + ref + ":" + commit
	ev := store.WebhookEvent{PipelineID: p.ID, PayloadDigest: digest}
	if err := s.DB.DB.Create(&ev).Error; err != nil {
		// A duplicate is only a skip when a webhook run for this commit was
		// actually created. Older builds left the event behind when trigger
		// failed, which poisoned every retry with a bogus "duplicate commit".
		var existing store.WebhookEvent
		if findErr := s.DB.DB.Where("payload_digest = ?", digest).First(&existing).Error; findErr != nil {
			return nil, false, err
		}
		var delivered int64
		if countErr := s.DB.DB.Model(&store.Run{}).
			Where("pipeline_id = ? AND ref = ? AND runs.`commit` = ? AND trigger_type = ?", p.ID, ref, commit, "webhook").
			Count(&delivered).Error; countErr != nil {
			return nil, false, countErr
		}
		if delivered > 0 {
			return nil, true, nil
		}
		if delErr := s.DB.DB.Delete(&existing).Error; delErr != nil {
			return nil, false, delErr
		}
	}
	run, err := s.trigger(p, repo, "webhook", ref, branch, commit, config)
	if err != nil {
		// The event exists only to deduplicate a delivered run. If starting
		// the run failed, remove it so the provider's retry can succeed.
		_ = s.DB.DB.Delete(&ev).Error
		return nil, false, err
	}
	return run, false, nil
}

func (s *Server) doScan(repo *store.Repository) {
	dir := s.repoDir(repo.ID)
	url := s.cloneURL(repo)
	var err error

	// Detect the remote's real default branch first (ls-remote, no clone
	// needed) so we don't try to clone a branch that doesn't exist.
	realDefault := repo.DefaultBranch
	if b, berr := gitx.RemoteDefaultBranch(url); berr == nil && b != "" {
		realDefault = b
		if b != repo.DefaultBranch {
			repo.DefaultBranch = b
			s.DB.DB.Model(repo).Update("default_branch", b)
		}
	}

	if _, statErr := os.Stat(filepath.Join(dir, ".git")); statErr != nil {
		err = gitx.Clone(dir, url, realDefault)
		if err != nil {
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

func isDuplicateError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") || strings.Contains(msg, "duplicate entry") || strings.Contains(msg, "database is locked")
}

func nextRunNumber(db *gorm.DB, pipelineID uint) int {
	var max int
	db.Model(&store.Run{}).Where("pipeline_id = ?", pipelineID).Select("COALESCE(MAX(number), 0)").Scan(&max)
	return max + 1
}

// normalizeRef returns a concrete git ref for a run. Incoming refs (webhook
// events, ref-specified manual runs) pass through unchanged; an empty ref with
// a known branch becomes refs/heads/<branch> so manual/cron runs record which
// branch they actually ran.
func normalizeRef(ref, branch string) string {
	if ref != "" {
		return ref
	}
	if branch == "" {
		return ""
	}
	return "refs/heads/" + branch
}
