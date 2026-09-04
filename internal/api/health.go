package api

import (
	"bytes"
	"context"
	"os"
	"time"

	"navori/internal/deploy"
	"navori/internal/registryx"
	"navori/internal/store"
)

// StartHealthChecker periodically tests registries and deploy targets,
// updating their last_test_status so the UI status lights refresh automatically.
func (s *Server) StartHealthChecker(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		s.runHealthCheck()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runHealthCheck()
			}
		}
	}()
}

func (s *Server) runHealthCheck() {
	s.checkRegistries()
	s.checkDeployTargets()
}

func (s *Server) checkRegistries() {
	var regs []store.Registry
	if err := s.DB.DB.Find(&regs).Error; err != nil {
		return
	}
	for i := range regs {
		username, password := s.registryCredentials(&regs[i])
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		err := registryx.CheckLogin(ctx, regs[i].URL, username, password)
		cancel()
		status := "error"
		if err == nil {
			status = "success"
		}
		now := time.Now()
		s.DB.DB.Model(&regs[i]).Updates(map[string]interface{}{"last_test_status": status, "last_test_at": now})
	}
}

func (s *Server) checkDeployTargets() {
	var dts []store.DeployTarget
	if err := s.DB.DB.Find(&dts).Error; err != nil {
		return
	}
	for i := range dts {
		kubeconfig := ""
		if dts[i].KubeconfigEnc != "" {
			kubeconfig, _ = s.Sec.Decrypt(dts[i].KubeconfigEnc)
		}
		path, err := writeTempKubeconfig(kubeconfig)
		if err != nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		var buf bytes.Buffer
		err = deploy.CheckKubeconfig(ctx, &buf, path)
		cancel()
		os.Remove(path)
		status := "error"
		if err == nil {
			status = "success"
		}
		now := time.Now()
		s.DB.DB.Model(&dts[i]).Updates(map[string]interface{}{"last_test_status": status, "last_test_at": now})
	}
}
