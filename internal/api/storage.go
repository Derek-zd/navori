package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// storagePaths are the directories whose disk usage we report/clean.
var storagePaths = []string{
	"/var/lib/containers", // podman overlay storage (base images, build layers, images)
	"/data",               // repos, logs, docker-config
}

// diskUsage reports used/total for one mounted path.
type diskUsage struct {
	Path    string  `json:"path"`
	Exists  bool    `json:"exists"`
	Percent float64 `json:"percent"`
	UsedGi  float64 `json:"usedGi"`
	TotalGi float64 `json:"totalGi"`
}

func statUsage(path string) diskUsage {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return diskUsage{Path: path, Exists: false}
	}
	total := st.Blocks * uint64(st.Bsize)
	avail := st.Bavail * uint64(st.Bsize)
	used := total - avail
	var pct float64
	if total > 0 {
		pct = float64(used) / float64(total) * 100
	}
	return diskUsage{
		Path:    path,
		Exists:  true,
		Percent: round1(pct),
		UsedGi:  round1(float64(used) / 1024 / 1024 / 1024),
		TotalGi: round1(float64(total) / 1024 / 1024 / 1024),
	}
}

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}

func allUsage() []diskUsage {
	out := make([]diskUsage, 0, len(storagePaths))
	for _, p := range storagePaths {
		out = append(out, statUsage(p))
	}
	return out
}

// highestUsagePercent returns the max usage across watched paths (0 if none exist).
func highestUsagePercent() float64 {
	max := 0.0
	for _, u := range allUsage() {
		if u.Exists && u.Percent > max {
			max = u.Percent
		}
	}
	return max
}

// runPodmanClean runs a podman/docker cleanup command and returns its trimmed output.
func runPodmanClean(mode string) (string, error) {
	var args []string
	switch mode {
	case "prune":
		args = []string{"builder", "prune", "-f"}
	case "deep":
		args = []string{"image", "prune", "-af"}
	default:
		return "", fmt.Errorf("unknown cleanup mode %q", mode)
	}
	cmd := exec.Command("docker", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

// cleanupStorage runs the requested cleanup, records it, and returns new usage.
func (s *Server) cleanupStorage(mode string) ([]diskUsage, string, error) {
	output, err := runPodmanClean(mode)
	if err != nil {
		return nil, output, err
	}
	now := time.Now()
	cfg := s.getAppConfig()
	cfg.LastCleanupAt = &now
	cfg.LastCleanupMode = mode
	if err := s.DB.DB.Save(cfg).Error; err != nil {
		return nil, output, err
	}
	return allUsage(), output, nil
}

// getStorageInfo returns current usage + cleanup policy for the UI.
func (s *Server) storageInfo() map[string]interface{} {
	cfg := s.getAppConfig()
	info := map[string]interface{}{
		"usage": allUsage(),
		"cleanup": map[string]interface{}{
			"frequency": cfg.CleanupFreq,
			"threshold": cfg.CleanupPercent,
			"lastAt":    cfg.LastCleanupAt,
			"lastMode":  cfg.LastCleanupMode,
		},
	}
	return info
}

// ---- HTTP handlers (admin) ----

func (s *Server) getStorage(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	ok(w, s.storageInfo())
}

func (s *Server) cleanStorage(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	var req struct {
		Mode string `json:"mode"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Mode != "prune" && req.Mode != "deep" {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "mode must be prune or deep")
		return
	}
	usage, output, err := s.cleanupStorage(req.Mode)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "storage.cleanup."+req.Mode, "")
	ok(w, map[string]interface{}{"usage": usage, "output": output})
}

func (s *Server) updateStoragePolicy(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		fail(w, http.StatusForbidden, "E_FORBIDDEN", "admin only")
		return
	}
	var req struct {
		Frequency string `json:"frequency"` // off|daily|weekly|monthly
		Threshold int    `json:"threshold"` // percent
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	switch req.Frequency {
	case "off", "daily", "weekly", "monthly":
	default:
		fail(w, http.StatusBadRequest, "E_VALIDATION", "frequency must be off|daily|weekly|monthly")
		return
	}
	if req.Threshold < 50 || req.Threshold > 99 {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "threshold must be 50-99")
		return
	}
	cfg := s.getAppConfig()
	cfg.CleanupFreq = req.Frequency
	cfg.CleanupPercent = req.Threshold
	if err := s.DB.DB.Save(cfg).Error; err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "storage.policy.update", fmt.Sprintf("%s/%d%%", req.Frequency, req.Threshold))
	ok(w, s.storageInfo())
}

// cleanupDue decides whether a scheduled cleanup with the given frequency
// should fire at now, given the last run time.
func cleanupDue(lastAt *time.Time, freq string, now time.Time) bool {
	if freq == "off" {
		return false
	}
	if lastAt == nil {
		return true
	}
	last := *lastAt
	switch freq {
	case "daily":
		return now.Sub(last) >= 24*time.Hour
	case "weekly":
		return now.Sub(last) >= 7*24*time.Hour
	case "monthly":
		return now.Sub(last) >= 30*24*time.Hour
	default:
		return false
	}
}

// lastCleanupDue reports whether the scheduled cleanup should run now.
func (s *Server) lastCleanupDue(now time.Time) bool {
	cfg := s.getAppConfig()
	return cleanupDue(cfg.LastCleanupAt, cfg.CleanupFreq, now)
}

// StartStorageCleaner periodically prunes build cache according to the
// configured frequency, escalating to a deep image prune when usage exceeds
// the configured threshold. Failures are logged and never crash the server.
func (s *Server) StartStorageCleaner(ctx context.Context) {
	go func() {
		tick := time.NewTicker(time.Minute)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-tick.C:
				if !s.lastCleanupDue(now) {
					continue
				}
				cfg := s.getAppConfig()
				log.Printf("storage: scheduled prune (frequency=%s)", cfg.CleanupFreq)
				if _, _, err := s.cleanupStorage("prune"); err != nil {
					log.Printf("storage: scheduled prune failed: %v", err)
					continue
				}
				// escalate to deep only when usage is still high
				if pct := highestUsagePercent(); pct >= float64(cfg.CleanupPercent) {
					log.Printf("storage: usage %.1f%% still above threshold %d%%, running deep clean", pct, cfg.CleanupPercent)
					if _, _, err := s.cleanupStorage("deep"); err != nil {
						log.Printf("storage: scheduled deep clean failed: %v", err)
					}
				}
			}
		}
	}()
}
