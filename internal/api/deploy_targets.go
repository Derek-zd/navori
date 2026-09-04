package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"navori/internal/deploy"
	"navori/internal/store"
)

func (s *Server) listDeployTargets(w http.ResponseWriter, r *http.Request) {
	var dts []store.DeployTarget
	if err := s.DB.DB.Order("id desc").Find(&dts).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(dts))
	for _, v := range dts {
		out = append(out, s.deployTargetWithLast(v))
	}
	ok(w, out)
}

func (s *Server) createDeployTarget(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name             string
		Type             string
		Kubeconfig       string
		DefaultNamespace string
		IsDefault        bool
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name == "" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "name is required")
		return
	}
	if req.Type == "" {
		req.Type = "k8s"
	}
	dt := store.DeployTarget{Name: req.Name, Type: req.Type, DefaultNamespace: req.DefaultNamespace, IsDefault: req.IsDefault}
	if req.Kubeconfig != "" {
		enc, err := s.Sec.Encrypt(req.Kubeconfig)
		if err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
		dt.KubeconfigEnc = enc
	}
	if err := s.DB.DB.Create(&dt).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "deploytarget.create", dt.Name)
	created(w, deployTargetJSON(dt))
}

func (s *Server) getDeployTarget(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var dt store.DeployTarget
	if err := s.DB.DB.First(&dt, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "deploy target not found")
		return
	}
	ok(w, deployTargetJSON(dt))
}

func (s *Server) updateDeployTarget(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var dt store.DeployTarget
	if err := s.DB.DB.First(&dt, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "deploy target not found")
		return
	}
	var req struct {
		Name             *string
		Kubeconfig       *string
		DefaultNamespace *string
		IsDefault        *bool
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid body")
		return
	}
	if req.Name != nil {
		dt.Name = *req.Name
	}
	if req.Kubeconfig != nil && *req.Kubeconfig != "" {
		enc, err := s.Sec.Encrypt(*req.Kubeconfig)
		if err != nil {
			fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
			return
		}
		dt.KubeconfigEnc = enc
	}
	if req.DefaultNamespace != nil {
		dt.DefaultNamespace = *req.DefaultNamespace
	}
	if req.IsDefault != nil {
		dt.IsDefault = *req.IsDefault
	}
	if err := s.DB.DB.Save(&dt).Error; err != nil {
		fail(w, http.StatusConflict, "E_CONFLICT", err.Error())
		return
	}
	s.audit(r, "deploytarget.update", dt.Name)
	ok(w, deployTargetJSON(dt))
}

func (s *Server) deleteDeployTarget(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	if err := s.DB.DB.Delete(&store.DeployTarget{}, id).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "deploytarget.delete", strconv.FormatUint(uint64(id), 10))
	ok(w, map[string]interface{}{})
}

func (s *Server) testDeployTarget(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var dt store.DeployTarget
	if err := s.DB.DB.First(&dt, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "deploy target not found")
		return
	}
	kubeconfig := ""
	if dt.KubeconfigEnc != "" {
		kubeconfig, _ = s.Sec.Decrypt(dt.KubeconfigEnc)
	}
	path, err := writeTempKubeconfig(kubeconfig)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	defer os.Remove(path)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var buf bytes.Buffer
	if err := deploy.CheckKubeconfig(ctx, &buf, path); err != nil {
		s.updateDeployTargetTestStatus(&dt, "error")
		fail(w, http.StatusBadRequest, "E_CONNECT_FAILED", strings.TrimSpace(buf.String()))
		return
	}
	s.updateDeployTargetTestStatus(&dt, "success")
	ok(w, map[string]interface{}{"ok": true})
}

func (s *Server) updateDeployTargetTestStatus(dt *store.DeployTarget, status string) {
	now := time.Now()
	dt.LastTestStatus = status
	dt.LastTestAt = &now
	s.DB.DB.Model(dt).Updates(map[string]interface{}{"last_test_status": status, "last_test_at": now})
}
func writeTempKubeconfig(content string) (string, error) {
	f, err := os.CreateTemp("", "navori-kube-*.yaml")
	if err != nil {
		return "", err
	}
	if _, err := f.WriteString(content); err != nil {
		f.Close()
		return "", err
	}
	f.Close()
	return f.Name(), nil
}

func (s *Server) deployTargetWithLast(v store.DeployTarget) map[string]interface{} {
	out := deployTargetJSON(v)
	out["lastDeploy"] = s.lastDeployFor(v.ID)
	return out
}

func (s *Server) lastDeployFor(dtID uint) map[string]interface{} {
	var runs []store.Run
	s.DB.DB.Where("status = ?", "success").Order("id desc").Limit(50).Find(&runs)
	for i := range runs {
		if s.runDeploysTarget(&runs[i], dtID) {
			return map[string]interface{}{
				"runId":      runs[i].ID,
				"number":     runs[i].Number,
				"imageTag":   runs[i].ImageTag,
				"finishedAt": runs[i].FinishedAt,
			}
		}
	}
	return nil
}

func (s *Server) getDeployTargetHistory(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var runs []store.Run
	s.DB.DB.Order("id desc").Limit(50).Find(&runs)
	out := make([]map[string]interface{}, 0, len(runs))
	for i := range runs {
		if s.runDeploysTarget(&runs[i], id) {
			out = append(out, s.runJSON(runs[i]))
		}
	}
	ok(w, out)
}

func (s *Server) runDeploysTarget(run *store.Run, dtID uint) bool {
	if run == nil {
		return false
	}
	var cfg map[string]interface{}
	_ = json.Unmarshal([]byte(run.ConfigSnapshotJSON), &cfg)
	deploy, _ := cfg["deploy"].(map[string]interface{})
	if deploy == nil {
		return false
	}
	tid, _ := deploy["targetId"].(float64)
	return uint(tid) == dtID
}

func deployTargetJSON(v store.DeployTarget) map[string]interface{} {
	return map[string]interface{}{
		"id":               v.ID,
		"name":             v.Name,
		"type":             v.Type,
		"defaultNamespace": v.DefaultNamespace,
		"kubeconfigSet":    v.KubeconfigEnc != "",
		"isDefault":        v.IsDefault,
		"lastTestStatus":   v.LastTestStatus,
		"lastTestAt":       v.LastTestAt,
	}
}
