package api

import (
	"context"
	"log"
	"time"

	"navori/internal/cronutil"
	"navori/internal/gitx"
	"navori/internal/store"
)

// StartScheduler periodically checks pipelines with a cron schedule and
// triggers those whose schedule matches the current minute.
func (s *Server) StartScheduler(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				s.runScheduled(now)
			}
		}
	}()
}

func (s *Server) runScheduled(now time.Time) {
	var ps []store.Pipeline
	if err := s.DB.DB.Find(&ps).Error; err != nil {
		return
	}
	for i := range ps {
		if ps[i].Schedule == "" || !cronutil.Match(ps[i].Schedule, now) {
			continue
		}
		s.triggerScheduled(&ps[i])
	}
}

func (s *Server) triggerScheduled(p *store.Pipeline) {
	var repo store.Repository
	if err := s.DB.DB.First(&repo, p.RepoID).Error; err != nil {
		return
	}
	head, err := gitx.RemoteHead(s.cloneURL(&repo))
	if err != nil {
		log.Printf("scheduled ls-remote pipeline %d failed: %v", p.ID, err)
		return
	}
	var last store.Run
	if err := s.DB.DB.Where("pipeline_id = ?", p.ID).Order("id desc").First(&last).Error; err == nil && last.Commit != "" && last.Commit == head {
		log.Printf("scheduled skip pipeline %d: no new commit %s", p.ID, head)
		return // no new commit on default branch
	}
	// cron targets the remote's actual default branch (self-heals stale value)
	branch := s.resolveDefaultBranch(&repo)
	config, ok := s.resolveForBranch(p, &repo, branch)
	if !ok {
		return
	}
	if _, err := s.trigger(p, &repo, "cron", "", branch, head, config); err != nil {
		log.Printf("scheduled run pipeline %d failed: %v", p.ID, err)
	}
}
