package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"navori/internal/agentx"
	"navori/internal/store"
)

const agentCheckWait = 35 * time.Second

// claimCheck returns a pending one-off check for this agent. Checks take
// priority over pipeline steps so an interactive "test connection" does not
// wait behind a long build.
func (s *Server) claimCheck(a *store.Agent) (*agentx.Job, bool, error) {
	var checks []store.AgentCheck
	if err := s.DB.DB.Where("agent_id = ? AND status = ?", a.ID, "pending").
		Order("id asc").Limit(5).Find(&checks).Error; err != nil {
		return nil, false, err
	}
	for _, c := range checks {
		res := s.DB.DB.Model(&store.AgentCheck{}).
			Where("id = ? AND status = ?", c.ID, "pending").
			Updates(map[string]interface{}{"status": "running", "started_at": time.Now().UTC()})
		if res.Error != nil {
			return nil, false, res.Error
		}
		if res.RowsAffected == 0 {
			continue
		}
		var dt store.DeployTarget
		if err := s.DB.DB.First(&dt, c.DeployTargetID).Error; err != nil {
			s.finishCheck(c.ID, false, "deploy target no longer exists")
			continue
		}
		kubeconfig := ""
		if dt.KubeconfigEnc != "" {
			kubeconfig, _ = s.Sec.Decrypt(dt.KubeconfigEnc)
		}
		params, _ := json.Marshal(agentx.DeployCheckParams{
			Kubeconfig:     kubeconfig,
			Namespace:      dt.DefaultNamespace,
			TimeoutSeconds: 20,
		})
		return &agentx.Job{
			JobID:        c.ID,
			Kind:         "deploy-check",
			StepName:     "deploy-check",
			LeaseSeconds: 60,
			Deadline:     time.Now().UTC().Add(time.Minute),
			Params:       params,
		}, true, nil
	}
	return nil, false, nil
}

// finishCheck writes the terminal state of a check and logs unexpected
// failures. Duplicate/late results are ignored.
func (s *Server) finishCheck(id uint, ok bool, msg string) {
	status := "failed"
	if ok {
		status = "success"
		msg = ""
	}
	res := s.DB.DB.Model(&store.AgentCheck{}).
		Where("id = ? AND status IN (?)", id, []string{"pending", "running"}).
		Updates(map[string]interface{}{
			"status":      status,
			"error":       msg,
			"finished_at": time.Now().UTC(),
		})
	if res.Error != nil {
		log.Printf("agent check %d: finish: %v", id, res.Error)
	} else if res.RowsAffected == 0 {
		log.Printf("agent check %d: late or duplicate result ignored", id)
	}
}

func (s *Server) agentCheckResult(w http.ResponseWriter, r *http.Request) {
	a := agentFrom(r)
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid check id")
		return
	}
	var c store.AgentCheck
	if err := s.DB.DB.First(&c, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "check not found")
		return
	}
	if c.AgentID != a.ID {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "check not assigned to this agent")
		return
	}
	if c.Status == "success" || c.Status == "failed" {
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "ignored": true})
		return
	}
	var req agentx.CheckResultReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	s.finishCheck(id, req.OK, trimLimit(req.Error, 2000))
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

// testDeployTargetViaAgent waits for the bound agent to run a one-off kubectl
// check. The handler polls the DB instead of keeping an in-memory waiter so a
// server restart or a very fast agent cannot lose the result.
func (s *Server) testDeployTargetViaAgent(ctx context.Context, dt *store.DeployTarget) (bool, string) {
	var a store.Agent
	if err := s.DB.DB.First(&a, dt.AgentID).Error; err != nil {
		return false, "部署环境绑定的执行器已不存在，请重新选择"
	}
	if a.Status != "online" {
		return false, "执行器 " + a.Name + " 当前离线，无法测试"
	}
	c := store.AgentCheck{AgentID: a.ID, DeployTargetID: dt.ID, Status: "pending"}
	if err := s.DB.DB.Create(&c).Error; err != nil {
		return false, err.Error()
	}
	timer := time.NewTimer(agentCheckWait)
	defer timer.Stop()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.finishCheck(c.ID, false, "request cancelled")
			return false, "测试请求已取消"
		case <-timer.C:
			s.finishCheck(c.ID, false, "timed out waiting for agent")
			return false, "执行器测试超时（35 秒）"
		case <-ticker.C:
			if err := s.DB.DB.First(&c, c.ID).Error; err != nil {
				return false, err.Error()
			}
			if c.Status == "success" {
				return true, ""
			}
			if c.Status == "failed" {
				msg := c.Error
				if msg == "" {
					msg = "执行器测试失败"
				}
				return false, msg
			}
		}
	}
}
