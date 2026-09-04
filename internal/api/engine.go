package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"navori/internal/buildx"
	"navori/internal/deploy"
	"navori/internal/gitx"
	"navori/internal/notify"
	"navori/internal/store"
	"navori/internal/tagx"
)

var errRejected = errors.New("rejected")

type deployConfig struct {
	TargetID  uint
	Kind      string
	Name      string
	Namespace string
	Container string
	Approval  bool
	Approvers []string
}

// resolvedConfig is the effective pipeline config after branch-rule resolution.
type resolvedConfig struct {
	DockerfilePath string
	BuildContext   string
	BuildArgs      map[string]string
	Platform       string
	ImageName      string
	TagTemplate    string
	RegistryID     uint
	Variables      map[string]string
	Deploy         deployConfig
}

func parseResolvedConfig(cfg map[string]interface{}) resolvedConfig {
	b, _ := json.Marshal(cfg)
	var rc resolvedConfig
	_ = json.Unmarshal(b, &rc)
	return rc
}

func shortCommit(c string) string {
	if len(c) > 7 {
		return c[:7]
	}
	return c
}

func nowPtr() *time.Time {
	t := time.Now()
	return &t
}

func timeStr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

func (s *Server) runLogDir(runID uint) string {
	return filepath.Join(s.Cfg.DataDir, "logs", strconv.FormatUint(uint64(runID), 10))
}

// executeRun runs all steps of a run in order.
func (s *Server) executeRun(run *store.Run, repo *store.Repository, branch string, config map[string]interface{}) {
	ctx, cancel := context.WithCancel(context.Background())
	s.setCancel(run.ID, cancel)
	defer s.clearCancel(run.ID)
	defer s.notifyTerminal(run, repo)

	var steps []store.Step
	s.DB.DB.Where("run_id = ?", run.ID).Order("step_order").Find(&steps)

	imageTag := ""
	for i := range steps {
		if steps[i].Name == "build" || steps[i].Name == "push" || steps[i].Name == "deploy" {
			if imageTag == "" {
				tag, err := s.resolveImageTag(run, repo, branch, config)
				if err != nil {
					s.failRun(run, steps[i:], err.Error())
					return
				}
				imageTag = tag
				s.DB.DB.Model(run).Updates(map[string]interface{}{"image_tag": imageTag})
			}
		}
		if err := s.executeStep(ctx, run, repo, branch, config, imageTag, &steps[i]); err != nil {
			terminal := "failed"
			if errors.Is(err, errRejected) {
				terminal = "rejected"
			} else if ctx.Err() != nil {
				terminal = "cancelled"
			}
			for j := i + 1; j < len(steps); j++ {
				s.DB.DB.Model(&steps[j]).Updates(map[string]interface{}{"status": "skipped"})
			}
			s.DB.DB.Model(run).Updates(map[string]interface{}{"status": terminal, "finished_at": nowPtr()})
			return
		}
	}
	s.DB.DB.Model(run).Updates(map[string]interface{}{"status": "success", "finished_at": nowPtr()})
}

func (s *Server) failRun(run *store.Run, steps []store.Step, msg string) {
	for i := range steps {
		s.DB.DB.Model(&steps[i]).Updates(map[string]interface{}{"status": "skipped"})
	}
	s.DB.DB.Model(run).Updates(map[string]interface{}{"status": "failed", "error": msg, "finished_at": nowPtr()})
}

func (s *Server) executeStep(ctx context.Context, run *store.Run, repo *store.Repository, branch string, config map[string]interface{}, imageTag string, step *store.Step) error {
	s.DB.DB.Model(step).Updates(map[string]interface{}{"status": "running", "started_at": nowPtr()})

	logDir := s.runLogDir(run.ID)
	_ = os.MkdirAll(logDir, 0o755)
	logFile := filepath.Join(logDir, step.Name+".log")
	s.DB.DB.Model(step).Updates(map[string]interface{}{"log_file": logFile})

	f, err := os.Create(logFile)
	if err != nil {
		s.DB.DB.Model(step).Updates(map[string]interface{}{"status": "failed", "finished_at": nowPtr()})
		return err
	}
	defer f.Close()

	rc := parseResolvedConfig(config)
	var stepErr error
	switch step.Name {
	case "pull":
		stepErr = s.stepPull(ctx, f, repo, branch)
	case "build":
		stepErr = s.stepBuild(ctx, f, repo, rc, imageTag)
	case "push":
		stepErr = s.stepPush(ctx, f, rc, imageTag)
	case "approve":
		stepErr = s.stepApprove(ctx, f, run, step)
	case "deploy":
		stepErr = s.stepDeploy(ctx, f, rc, imageTag)
	default:
		stepErr = fmt.Errorf("unknown step %s", step.Name)
	}

	if stepErr != nil {
		s.DB.DB.Model(step).Updates(map[string]interface{}{"status": "failed", "finished_at": nowPtr()})
		if !errors.Is(stepErr, errRejected) {
			s.DB.DB.Model(run).Updates(map[string]interface{}{"error": stepErr.Error()})
		}
		log.Printf("run %d step %s failed: %v", run.ID, step.Name, stepErr)
		return stepErr
	}
	s.DB.DB.Model(step).Updates(map[string]interface{}{"status": "success", "finished_at": nowPtr()})
	return nil
}

func (s *Server) stepPull(ctx context.Context, w io.Writer, repo *store.Repository, branch string) error {
	dir := s.repoDir(repo.ID)
	url := s.cloneURL(repo)
	fmt.Fprintf(w, "branch=%s\n", branch)

	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		if err := gitx.CloneW(dir, url, branch, w); err != nil {
			return err
		}
		if branch != "" {
			if err := gitx.CheckoutW(dir, branch, w); err != nil {
				return err
			}
		}
	} else {
		if err := gitx.CheckoutW(dir, branch, w); err != nil {
			return err
		}
		if err := gitx.PullW(dir, w); err != nil {
			return err
		}
	}
	if hc, err := gitx.HeadCommit(dir); err == nil {
		fmt.Fprintf(w, "HEAD commit: %s\n", hc)
	}
	return nil
}
func (s *Server) stepBuild(ctx context.Context, w io.Writer, repo *store.Repository, rc resolvedConfig, imageTag string) error {
	dockerfile := rc.DockerfilePath
	if dockerfile == "" {
		dockerfile = repo.DockerfilePath
	}
	if dockerfile == "" {
		dockerfile = "Dockerfile"
	}
	context := rc.BuildContext
	if context == "" {
		context = "."
	}
	dockerConfig := filepath.Join(s.Cfg.DataDir, "docker-config")
	if err := os.MkdirAll(dockerConfig, 0o755); err != nil {
		return err
	}
	configPath := filepath.Join(dockerConfig, "config.json")
	if _, err := os.Stat(configPath); err != nil {
		_ = os.WriteFile(configPath, []byte("{\"auths\":{}}"), 0o600)
	}
	return buildx.Build(ctx, w, s.repoDir(repo.ID), dockerfile, imageTag, rc.Platform, rc.BuildArgs, dockerConfig)
}
func (s *Server) stepPush(ctx context.Context, w io.Writer, rc resolvedConfig, imageTag string) error {
	if rc.RegistryID == 0 {
		return buildx.Push(ctx, w, imageTag, "")
	}
	var reg store.Registry
	if err := s.DB.DB.First(&reg, rc.RegistryID).Error; err != nil {
		return err
	}
	username, password := s.registryCredentials(&reg)
	configDir := ""
	if username != "" {
		var err error
		configDir, err = buildx.WriteAuthConfig(reg.URL, username, password)
		if err != nil {
			return err
		}
		defer os.RemoveAll(configDir)
	}
	return buildx.Push(ctx, w, imageTag, configDir)
}

// stepApprove sets run to awaiting_approval and waits for an approve/reject decision.
func (s *Server) stepApprove(ctx context.Context, w io.Writer, run *store.Run, step *store.Step) error {
	s.DB.DB.Model(run).Updates(map[string]interface{}{"status": "awaiting_approval"})
	s.DB.DB.Model(step).Updates(map[string]interface{}{"status": "awaiting_approval"})
	fmt.Fprintf(w, "等待人工审批...\n")
	go s.notifyApproval(run, "approval.requested", "awaiting_approval")

	ch := make(chan string, 1)
	s.approveMu.Lock()
	if s.approveChans == nil {
		s.approveChans = make(map[uint]chan string)
	}
	s.approveChans[run.ID] = ch
	s.approveMu.Unlock()
	defer func() {
		s.approveMu.Lock()
		delete(s.approveChans, run.ID)
		s.approveMu.Unlock()
	}()

	select {
	case decision := <-ch:
		var fresh store.Run
		s.DB.DB.First(&fresh, run.ID)
		approvedAt := ""
		if fresh.ApprovedAt != nil {
			approvedAt = fresh.ApprovedAt.Format(time.RFC3339)
		}
		if decision == "approve" {
			fmt.Fprintf(w, "审批通过  审批人=%s  时间=%s\n", fresh.ApprovedBy, approvedAt)
			return nil
		}
		fmt.Fprintf(w, "审批拒绝  审批人=%s  时间=%s  原因=%s\n", fresh.ApprovedBy, approvedAt, fresh.RejectedReason)
		return errRejected
	case <-ctx.Done():
		return ctx.Err()
	}
}

// stepDeploy updates the workload image via kubectl.
func (s *Server) stepDeploy(ctx context.Context, w io.Writer, rc resolvedConfig, imageTag string) error {
	if rc.Deploy.TargetID == 0 {
		return fmt.Errorf("deploy config missing targetId")
	}
	if rc.Deploy.Name == "" {
		return fmt.Errorf("deploy config missing name")
	}
	var dt store.DeployTarget
	if err := s.DB.DB.First(&dt, rc.Deploy.TargetID).Error; err != nil {
		return fmt.Errorf("deploy target %d not found", rc.Deploy.TargetID)
	}
	kubeconfig := ""
	if dt.KubeconfigEnc != "" {
		kubeconfig, _ = s.Sec.Decrypt(dt.KubeconfigEnc)
	}
	path, err := writeTempKubeconfig(kubeconfig)
	if err != nil {
		return err
	}
	defer os.Remove(path)

	kind := rc.Deploy.Kind
	if kind == "" {
		kind = "Deployment"
	}
	namespace := rc.Deploy.Namespace
	if namespace == "" {
		namespace = dt.DefaultNamespace
	}
	container := rc.Deploy.Container
	if container == "" {
		container = rc.ImageName
	}
	t := deploy.Target{Kubeconfig: path, Kind: kind, Name: rc.Deploy.Name, Namespace: namespace, Container: container, Image: imageTag}

	fmt.Fprintf(w, "deploy:\n")
	fmt.Fprintf(w, "  目标: %s\n", dt.Name)
	fmt.Fprintf(w, "  workload: %s/%s\n", kind, rc.Deploy.Name)
	fmt.Fprintf(w, "  命名空间: %s\n", namespace)
	fmt.Fprintf(w, "  容器: %s\n", container)
	fmt.Fprintf(w, "  镜像: %s\n", imageTag)

	if err := deploy.SetImage(ctx, w, t); err != nil {
		return err
	}
	if err := deploy.RolloutStatus(ctx, w, t, "5m"); err != nil {
		_ = deploy.RolloutUndo(ctx, w, t)
		return err
	}
	return nil
}

// notifyTerminal sends notifications when a run reaches a terminal state.
func (s *Server) notifyTerminal(run *store.Run, repo *store.Repository) {
	var fresh store.Run
	if err := s.DB.DB.First(&fresh, run.ID).Error; err != nil {
		return
	}
	var p store.Pipeline
	if err := s.DB.DB.First(&p, fresh.PipelineID).Error; err != nil {
		return
	}
	var nf map[string]interface{}
	if err := json.Unmarshal([]byte(p.NotifyJSON), &nf); err != nil {
		return
	}

	ev := notify.Event{
		"event":       "run.finished",
		"pipelineId":  fresh.PipelineID,
		"repo":        repo.Name,
		"branch":      stripRef(fresh.Ref),
		"commit":      fresh.Commit,
		"commitShort": shortCommit(fresh.Commit),
		"status":      fresh.Status,
		"imageTag":    fresh.ImageTag,
		"error":       fresh.Error,
		"finishedAt":  timeStr(fresh.FinishedAt),
	}

	// legacy single webhook
	if url, _ := nf["webhookUrl"].(string); url != "" {
		secret, _ := nf["secret"].(string)
		s.sendWithRetry(ev, func() error { return notify.Send(url, secret, ev) })
	}

	// new multi-channel
	if chans, ok := nf["channels"].([]interface{}); ok {
		for _, c := range chans {
			cm, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			idf, _ := cm["id"].(float64)
			var ch store.NotifyChannel
			if err := s.DB.DB.First(&ch, uint(idf)).Error; err != nil {
				continue
			}
			if !s.channelWantsEvent(cm, fresh.Status) {
				continue
			}
			cfg := s.decryptChannelConfig(ch.ConfigJSON)
			ctype := ch.Type
			if ctype == "email" {
				// email channel stores only recipient; SMTP comes from system settings
				smtp := s.smtpConfig()
				to, _ := cfg["to"].(string)
				merged := map[string]interface{}{}
				for k, v := range smtp {
					merged[k] = v
				}
				merged["to"] = to
				cfg = merged
			}
			s.sendWithRetry(ev, func() error { return notify.SendChannel(ctype, cfg, ev) })
		}
	}
}

// channelWantsEvent reports whether a channel binding should fire for status.
func (s *Server) channelWantsEvent(cm map[string]interface{}, status string) bool {
	evs, ok := cm["events"].([]interface{})
	if !ok || len(evs) == 0 {
		return true // no events filter -> notify all terminal states
	}
	for _, e := range evs {
		if es, _ := e.(string); es == status {
			return true
		}
	}
	return false
}

func (s *Server) sendWithRetry(ev notify.Event, fn func() error) {
	var lastErr error
	for i := 0; i < 3; i++ {
		if err := fn(); err == nil {
			return
		} else {
			lastErr = err
			time.Sleep(time.Duration(i+1) * time.Second)
		}
	}
	log.Printf("notify failed: %v", lastErr)
}

// resolveImageTag resolves the commit (if missing) and computes the full image tag.
func (s *Server) resolveImageTag(run *store.Run, repo *store.Repository, branch string, config map[string]interface{}) (string, error) {
	if run.Commit == "" {
		commit, err := gitx.HeadCommit(s.repoDir(repo.ID))
		if err != nil {
			return "", fmt.Errorf("resolve commit: %w", err)
		}
		run.Commit = commit
		s.DB.DB.Model(run).Updates(map[string]interface{}{"commit": commit})
	}
	return s.computeImageTag(run, repo, branch, config)
}

// computeImageTag renders the tag template and builds the full image reference.
func (s *Server) computeImageTag(run *store.Run, repo *store.Repository, branch string, config map[string]interface{}) (string, error) {
	rc := parseResolvedConfig(config)
	if rc.ImageName == "" {
		return "", fmt.Errorf("pipeline config missing imageName")
	}
	if rc.RegistryID == 0 {
		return "", fmt.Errorf("pipeline config missing registryId")
	}
	var registry store.Registry
	if err := s.DB.DB.First(&registry, rc.RegistryID).Error; err != nil {
		return "", fmt.Errorf("registry %d not found", rc.RegistryID)
	}
	tagTemplate := rc.TagTemplate
	if tagTemplate == "" {
		tagTemplate = "{branch}-{commit_short}"
	}
	vars := map[string]string{
		"branch":       tagx.SanitizeBranch(branch),
		"branch_raw":   branch,
		"commit":       run.Commit,
		"commit_short": shortCommit(run.Commit),
		"timestamp":    time.Now().Format("20060102-150405"),
		"unix":         strconv.FormatInt(time.Now().Unix(), 10),
		"build_number": strconv.Itoa(run.Number),
	}
	var varsList []store.Variable
	s.DB.DB.Find(&varsList)
	for _, v := range varsList {
		if val, err := s.Sec.Decrypt(v.ValueEnc); err == nil {
			vars["var."+v.Key] = val
		}
	}
	for k, val := range rc.Variables {
		vars["var."+k] = val
	}
	tag, err := tagx.Render(tagTemplate, vars)
	if err != nil {
		return "", err
	}
	if err := tagx.Validate(tag); err != nil {
		return "", err
	}
	host := strings.TrimPrefix(strings.TrimPrefix(registry.URL, "https://"), "http://")
	host = strings.TrimSuffix(host, "/")
	parts := []string{host}
	if registry.Namespace != "" {
		parts = append(parts, registry.Namespace)
	}
	parts = append(parts, rc.ImageName+":"+tag)
	return strings.Join(parts, "/"), nil
}

// ---- cancel ----

func (s *Server) setCancel(runID uint, cancel context.CancelFunc) {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	if s.cancels == nil {
		s.cancels = make(map[uint]context.CancelFunc)
	}
	s.cancels[runID] = cancel
}

func (s *Server) clearCancel(runID uint) {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	delete(s.cancels, runID)
}

func (s *Server) cancelRun(runID uint) bool {
	s.cancelMu.Lock()
	cancel, ok := s.cancels[runID]
	s.cancelMu.Unlock()
	if ok {
		cancel()
		return true
	}
	return false
}

// ReapInFlight marks runs interrupted by a restart as failed.
func (s *Server) ReapInFlight() {
	s.DB.DB.Model(&store.Run{}).
		Where("status IN ?", []string{"running", "pending"}).
		Updates(map[string]interface{}{"status": "failed", "error": "service restarted during run", "finished_at": nowPtr()})
}
