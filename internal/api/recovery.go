package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"navori/internal/store"
)

// ResumeApprovals restarts the durable waiters for runs that were waiting for
// a human when the server stopped. A decision persisted before the restart is
// applied immediately; otherwise the run keeps waiting without occupying a
// connection or goroutine beyond a one-second poll.
func (s *Server) ResumeApprovals() {
	var runs []store.Run
	if err := s.DB.DB.Where("status = ?", "awaiting_approval").Find(&runs).Error; err != nil {
		log.Printf("resume approvals: %v", err)
		return
	}
	for i := range runs {
		run := runs[i]
		s.runWG.Add(1)
		go func() {
			defer s.runWG.Done()
			s.resumeAwaitingRun(run.ID)
		}()
	}
	if len(runs) > 0 {
		log.Printf("resume approvals: waiting on %d run(s)", len(runs))
	}
}

func (s *Server) resumeAwaitingRun(runID uint) {
	for {
		var run store.Run
		if err := s.DB.DB.First(&run, runID).Error; err != nil {
			return
		}
		if run.Status != "awaiting_approval" {
			return
		}
		switch run.ApprovalDecision {
		case "approved":
			res := s.DB.DB.Model(&store.Run{}).
				Where("id = ? AND status = ? AND approval_decision = ?", run.ID, "awaiting_approval", "approved").
				Updates(map[string]interface{}{"status": "running"})
			if res.Error != nil {
				log.Printf("resume approval run %d: %v", run.ID, res.Error)
				return
			}
			if res.RowsAffected > 0 {
				s.continueApprovedRun(&run)
				return
			}
		case "rejected":
			s.finalizeRejectedRun(&run)
			return
		}
		time.Sleep(time.Second)
	}
}

// continueApprovedRun executes the deploy step after an approval was recovered
// from the database. The approve step is marked successful and the remaining
// deploy step goes through the normal executeStep path (including agent
// dispatch, cancellation and failure handling).
func (s *Server) continueApprovedRun(run *store.Run) {
	repo, err := s.pipelineRepo(run.PipelineID)
	if err != nil {
		s.finishRun(run, "repo not found: "+err.Error())
		return
	}
	var config map[string]interface{}
	_ = json.Unmarshal([]byte(run.ConfigSnapshotJSON), &config)
	branch := stripRef(run.Ref)

	var steps []store.Step
	s.DB.DB.Where("run_id = ?", run.ID).Order("step_order").Find(&steps)
	var deployStep *store.Step
	for i := range steps {
		if steps[i].Name == "approve" {
			s.DB.DB.Model(&steps[i]).Updates(map[string]interface{}{"status": "success", "finished_at": nowPtr()})
		}
		if steps[i].Name == "deploy" {
			deployStep = &steps[i]
		}
	}
	if deployStep == nil {
		s.finishRun(run, "")
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.setCancel(run.ID, cancel)
	defer s.clearCancel(run.ID)
	defer s.notifyTerminalAsync(run, repo)

	imageTag := run.ImageTag
	if imageTag == "" {
		imageTag, err = s.resolveImageTag(run, repo, branch, config)
		if err != nil {
			s.finishRun(run, err.Error())
			return
		}
		s.DB.DB.Model(run).Update("image_tag", imageTag)
	}
	if err := s.executeStep(ctx, run, repo, branch, config, imageTag, deployStep); err != nil {
		terminal := "failed"
		if ctx.Err() != nil || errors.Is(err, errStepCancelled) {
			terminal = "cancelled"
		}
		s.markRemainingSkipped(run.ID, deployStep.StepOrder)
		s.DB.DB.Model(run).Updates(map[string]interface{}{"status": terminal, "finished_at": nowPtr()})
		return
	}
	s.DB.DB.Model(run).Updates(map[string]interface{}{"status": "success", "finished_at": nowPtr()})
}

func (s *Server) finalizeRejectedRun(run *store.Run) {
	repo, _ := s.pipelineRepo(run.PipelineID)
	var steps []store.Step
	s.DB.DB.Where("run_id = ?", run.ID).Order("step_order").Find(&steps)
	for i := range steps {
		if steps[i].Name == "approve" {
			s.DB.DB.Model(&steps[i]).Updates(map[string]interface{}{"status": "rejected", "finished_at": nowPtr()})
		} else if !isTerminalStep(steps[i].Status) {
			s.DB.DB.Model(&steps[i]).Update("status", "skipped")
		}
	}
	s.DB.DB.Model(run).Updates(map[string]interface{}{"status": "rejected", "error": errRejected.Error(), "finished_at": nowPtr()})
	if repo != nil {
		s.notifyTerminalAsync(run, repo)
	}
}

func (s *Server) finishRun(run *store.Run, msg string) {
	updates := map[string]interface{}{"status": "success", "finished_at": nowPtr()}
	if msg != "" {
		updates["status"] = "failed"
		updates["error"] = msg
	}
	s.DB.DB.Model(run).Updates(updates)
}

func (s *Server) markRemainingSkipped(runID uint, afterOrder int) {
	s.DB.DB.Model(&store.Step{}).Where("run_id = ? AND step_order > ? AND status IN ?", runID, afterOrder, []string{"pending", "queued", "running"}).Update("status", "skipped")
}

func (s *Server) pipelineRepo(pipelineID uint) (*store.Repository, error) {
	var p store.Pipeline
	if err := s.DB.DB.First(&p, pipelineID).Error; err != nil {
		return nil, err
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, p.RepoID).Error; err != nil {
		return nil, err
	}
	return &repo, nil
}

// cancelAwaitingRun finalizes a run that never started (or is waiting for a
// human decision). It is used by stop for the durable approval state, where no
// in-memory cancel func exists after a restart.
func (s *Server) cancelAwaitingRun(run *store.Run) bool {
	now := time.Now()
	res := s.DB.DB.Model(&store.Run{}).
		Where("id = ? AND status = ?", run.ID, "awaiting_approval").
		Updates(map[string]interface{}{"status": "cancelled", "finished_at": &now})
	if res.Error != nil || res.RowsAffected == 0 {
		return false
	}
	s.DB.DB.Model(&store.Step{}).
		Where("run_id = ? AND status = ?", run.ID, "awaiting_approval").
		Updates(map[string]interface{}{"status": "cancelled", "finished_at": &now, "lease_expires_at": nil})
	s.DB.DB.Model(&store.Step{}).
		Where("run_id = ? AND status IN ?", run.ID, []string{"pending", "queued", "running"}).
		Updates(map[string]interface{}{"status": "skipped", "lease_expires_at": nil})
	if repo, err := s.pipelineRepo(run.PipelineID); err == nil {
		s.notifyTerminalAsync(run, repo)
	}
	return true
}
