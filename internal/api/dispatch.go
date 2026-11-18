package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strconv"
	"time"

	"navori/internal/agentx"
	"navori/internal/store"
)

var errStepCancelled = errors.New("step cancelled by agent")

// stepResult is delivered by the result handler (or the lease janitor) to the
// engine goroutine waiting on this step.
type stepResult struct {
	Status string
	Error  string
}

// dispatchStep queues a step for a remote agent and waits for its outcome.
func (s *Server) dispatchStep(ctx context.Context, step *store.Step) error {
	ch := make(chan stepResult, 1)
	s.stepMu.Lock()
	if s.stepWaits == nil {
		s.stepWaits = make(map[uint]chan stepResult)
	}
	s.stepWaits[step.ID] = ch
	s.stepMu.Unlock()
	defer func() {
		s.stepMu.Lock()
		delete(s.stepWaits, step.ID)
		s.stepMu.Unlock()
	}()

	if err := s.DB.DB.Model(&store.Step{}).Where("id = ?", step.ID).Updates(map[string]interface{}{
		"status":           "queued",
		"agent_id":         0,
		"lease_expires_at": nil,
		"finished_at":      nil,
	}).Error; err != nil {
		return err
	}
	log.Printf("step.dispatch run=%d step=%d name=%s selector=%q", step.RunID, step.ID, step.Name, step.AgentSelector)

	timer := time.NewTimer(time.Duration(agentx.DefaultMaxStepSeconds) * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		s.finishStepIfActive(step.ID, "cancelled", "")
		return ctx.Err()
	case res := <-ch:
		switch res.Status {
		case "success":
			return nil
		case "cancelled":
			return errStepCancelled
		default:
			if res.Error == "" {
				res.Error = "agent reported failure"
			}
			return errors.New(res.Error)
		}
	case <-timer.C:
		msg := fmt.Sprintf("step exceeded %ds without a result", agentx.DefaultMaxStepSeconds)
		s.finishStepIfActive(step.ID, "failed", msg)
		return errors.New(msg)
	}
}

// finishStepIfActive moves a non-terminal step to status. It never overwrites
// a result that the agent already reported.
func (s *Server) finishStepIfActive(stepID uint, status, message string) {
	res := s.DB.DB.Model(&store.Step{}).
		Where("id = ? AND status IN ?", stepID, []string{"queued", "running", "awaiting_approval"}).
		Updates(map[string]interface{}{"status": status, "finished_at": nowPtr()})
	if res.Error != nil {
		log.Printf("step %d -> %s: %v", stepID, status, res.Error)
		return
	}
	if res.RowsAffected == 0 {
		return
	}
	log.Printf("step %d -> %s (%s)", stepID, status, message)
}

// notifyStep wakes the engine waiting on a step. Safe when nobody listens.
func (s *Server) notifyStep(stepID uint, res stepResult) {
	s.stepMu.Lock()
	ch := s.stepWaits[stepID]
	s.stepMu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- res:
	default:
	}
}

// ---- claim ----

func (s *Server) claimStep(a *store.Agent) (*agentx.Job, bool, error) {
	var steps []store.Step
	if err := s.DB.DB.Where("status = ? AND agent_selector <> ''", "queued").
		Order("id").Limit(50).Find(&steps).Error; err != nil {
		return nil, false, err
	}
	for i := range steps {
		if !agentx.MatchAgentSelector(steps[i].AgentSelector, a.Labels, a.ID) {
			continue
		}
		now := time.Now().UTC()
		res := s.DB.DB.Model(&store.Step{}).
			Where("id = ? AND status = ?", steps[i].ID, "queued").
			Updates(map[string]interface{}{
				"status":           "running",
				"agent_id":         a.ID,
				"started_at":       now,
				"lease_expires_at": now.Add(agentLease),
			})
		if res.Error != nil {
			return nil, false, res.Error
		}
		if res.RowsAffected == 0 {
			continue // another agent won the race
		}
		var run store.Run
		if err := s.DB.DB.First(&run, steps[i].RunID).Error; err != nil {
			s.failClaimedStep(steps[i].ID, err.Error())
			continue
		}
		job, err := s.buildJob(&steps[i], &run)
		if err != nil {
			s.failClaimedStep(steps[i].ID, err.Error())
			continue
		}
		log.Printf("step.claim run=%d step=%d name=%s agent=%q", steps[i].RunID, steps[i].ID, steps[i].Name, a.Name)
		s.DB.DB.Create(&store.AuditLog{Action: "step.dispatch", Target: strconv.FormatUint(uint64(steps[i].ID), 10)})
		return &job, true, nil
	}
	return nil, false, nil
}

func (s *Server) failClaimedStep(stepID uint, msg string) {
	s.finishStepIfActive(stepID, "failed", msg)
	s.notifyStep(stepID, stepResult{Status: "failed", Error: msg})
}

func (s *Server) buildJob(step *store.Step, run *store.Run) (agentx.Job, error) {
	now := time.Now().UTC()
	job := agentx.Job{
		JobID:        step.ID,
		RunID:        step.RunID,
		StepOrder:    step.StepOrder,
		StepName:     step.Name,
		LeaseSeconds: int(agentLease / time.Second),
		Deadline:     now.Add(time.Duration(agentx.DefaultMaxStepSeconds) * time.Second),
		ImageTag:     run.ImageTag,
	}

	var pipeline store.Pipeline
	if err := s.DB.DB.First(&pipeline, run.PipelineID).Error; err != nil {
		return job, err
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, pipeline.RepoID).Error; err != nil {
		return job, err
	}
	var cfg map[string]interface{}
	if run.ConfigSnapshotJSON != "" {
		_ = json.Unmarshal([]byte(run.ConfigSnapshotJSON), &cfg)
	}
	rc := parseResolvedConfig(cfg)
	dir := filepath.ToSlash(filepath.Join("workspace", strconv.FormatUint(uint64(repo.ID), 10)))

	var params interface{}
	switch step.Name {
	case "pull":
		params = agentx.PullParams{GitURL: s.cloneURL(&repo), Branch: stripRef(run.Ref), Dir: dir}
	case "build":
		dockerfile := rc.DockerfilePath
		if dockerfile == "" {
			dockerfile = repo.DockerfilePath
		}
		if dockerfile == "" {
			dockerfile = "Dockerfile"
		}
		params = agentx.BuildParams{Dir: dir, Dockerfile: dockerfile, Context: rc.BuildContext, Args: rc.BuildArgs, Platform: rc.Platform}
	case "push":
		p := agentx.PushParams{Image: run.ImageTag}
		if rc.RegistryID != 0 {
			var reg store.Registry
			if err := s.DB.DB.First(&reg, rc.RegistryID).Error; err != nil {
				return job, err
			}
			p.RegistryURL = reg.URL
			p.Username, p.Password = s.registryCredentials(&reg)
		}
		params = p
	case "deploy":
		if rc.Deploy.TargetID == 0 || rc.Deploy.Name == "" {
			return job, fmt.Errorf("deploy config missing targetId or name")
		}
		var dt store.DeployTarget
		if err := s.DB.DB.First(&dt, rc.Deploy.TargetID).Error; err != nil {
			return job, err
		}
		kubeconfig := ""
		if dt.KubeconfigEnc != "" {
			kubeconfig, _ = s.Sec.Decrypt(dt.KubeconfigEnc)
		}
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
		params = agentx.DeployParams{
			Kubeconfig:     base64.StdEncoding.EncodeToString([]byte(kubeconfig)),
			Kind:           kind,
			Name:           rc.Deploy.Name,
			Namespace:      namespace,
			Container:      container,
			Image:          run.ImageTag,
			TimeoutSeconds: 300,
		}
	default:
		return job, fmt.Errorf("step %s cannot be dispatched", step.Name)
	}
	raw, err := json.Marshal(params)
	if err != nil {
		return job, err
	}
	job.Params = raw
	return job, nil
}

// ---- lease janitor ----

// expireStepLeases requeues steps whose agent stopped renewing its lease, and
// fails them after two retries.
func (s *Server) expireStepLeases() {
	now := time.Now().UTC()
	var steps []store.Step
	if err := s.DB.DB.Where("status = ? AND lease_expires_at IS NOT NULL AND lease_expires_at < ?", "running", now).
		Find(&steps).Error; err != nil {
		log.Printf("step lease janitor: %v", err)
		return
	}
	for i := range steps {
		next := steps[i].Attempt + 1
		status := "queued"
		updates := map[string]interface{}{
			"attempt":          next,
			"status":           status,
			"agent_id":         0,
			"lease_expires_at": nil,
			"started_at":       nil,
		}
		if next > 2 {
			status = "failed"
			updates["status"] = status
			updates["finished_at"] = now
			delete(updates, "started_at")
		}
		res := s.DB.DB.Model(&store.Step{}).
			Where("id = ? AND status = ? AND lease_expires_at < ?", steps[i].ID, "running", now).
			Updates(updates)
		if res.Error != nil || res.RowsAffected == 0 {
			continue
		}
		log.Printf("step.lease_expired run=%d step=%d attempt=%d -> %s", steps[i].RunID, steps[i].ID, next, status)
		if status == "failed" {
			msg := "执行器失联，步骤已重试 2 次"
			s.notifyStep(steps[i].ID, stepResult{Status: "failed", Error: msg})
		}
	}
}
