package api

import (
	"encoding/json"

	"navori/internal/notify"
	"navori/internal/store"
)

// notifyApproval sends approval-related notifications to all channels bound
// to the run's pipeline. eventName is e.g. approval.requested/approved/rejected.
func (s *Server) notifyApproval(run *store.Run, eventName, status string) {
	if run == nil {
		return
	}
	var p store.Pipeline
	if err := s.DB.DB.First(&p, run.PipelineID).Error; err != nil {
		return
	}
	var repo store.Repository
	if err := s.DB.DB.First(&repo, p.RepoID).Error; err != nil {
		return
	}
	var nf map[string]interface{}
	if err := json.Unmarshal([]byte(p.NotifyJSON), &nf); err != nil {
		return
	}
	chans, ok := nf["channels"].([]interface{})
	if !ok || len(chans) == 0 {
		return
	}
	ev := notify.Event{
		"event":       eventName,
		"pipelineId":  run.PipelineID,
		"repo":        repo.Name,
		"branch":      stripRef(run.Ref),
		"commit":      run.Commit,
		"commitShort": shortCommit(run.Commit),
		"status":      status,
		"imageTag":    run.ImageTag,
		"approvedBy":  run.ApprovedBy,
		"error":       run.Error,
		"finishedAt":  timeStr(run.FinishedAt),
	}
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
		cfg := s.decryptChannelConfig(ch.ConfigJSON)
		ctype := ch.Type
		if ctype == "email" {
			smtp := s.smtpConfig()
			to, _ := cfg["to"].(string)
			merged := map[string]interface{}{}
			for k, v := range smtp {
				merged[k] = v
			}
			merged["to"] = to
			cfg = merged
		}
		_ = notify.SendChannel(ctype, cfg, ev)
	}
}
