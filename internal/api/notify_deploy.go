package api

import (
	"encoding/json"
	"fmt"

	"navori/internal/store"
)

// deployEvent builds the deploy block attached to run.finished notifications.
// The run config snapshot is already branch-resolved, so this reflects exactly
// what the deploy step attempted.
func (s *Server) deployEvent(run *store.Run) map[string]interface{} {
	var step store.Step
	if err := s.DB.DB.Where("run_id = ? AND name = ?", run.ID, "deploy").First(&step).Error; err != nil {
		return nil
	}
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(run.ConfigSnapshotJSON), &raw); err != nil {
		return nil
	}
	rc := parseResolvedConfig(raw)
	if rc.Deploy.TargetID == 0 && rc.Deploy.Name == "" {
		return nil
	}

	targetName := ""
	namespace := rc.Deploy.Namespace
	if rc.Deploy.TargetID > 0 {
		var dt store.DeployTarget
		if err := s.DB.DB.First(&dt, rc.Deploy.TargetID).Error; err == nil {
			targetName = dt.Name
			if namespace == "" {
				namespace = dt.DefaultNamespace
			}
		} else {
			targetName = fmt.Sprintf("部署目标 #%d", rc.Deploy.TargetID)
		}
	}
	if targetName == "" {
		targetName = "服务端本机"
	}
	if namespace == "" {
		namespace = "default"
	}
	kind := rc.Deploy.Kind
	if kind == "" {
		kind = "Deployment"
	}
	name := rc.Deploy.Name
	if name == "" {
		name = "—"
	}

	executor := "服务端本机"
	if step.AgentID > 0 {
		var agent store.Agent
		if err := s.DB.DB.First(&agent, step.AgentID).Error; err == nil {
			executor = agent.Name
		} else {
			executor = fmt.Sprintf("执行器 #%d", step.AgentID)
		}
	}

	errorMsg := ""
	switch step.Status {
	case "failed":
		errorMsg = run.Error
	case "skipped":
		if run.Status == "rejected" {
			errorMsg = "审批拒绝"
		} else {
			errorMsg = "前置步骤未完成"
		}
	case "cancelled":
		errorMsg = "运行已取消"
	}
	return map[string]interface{}{
		"targetId":   rc.Deploy.TargetID,
		"targetName": targetName,
		"kind":       kind,
		"name":       name,
		"namespace":  namespace,
		"status":     step.Status,
		"executor":   executor,
		"error":      errorMsg,
	}
}
