package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"golang.org/x/sys/unix"

	"navori/internal/store"
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

// cleanupCommands returns the podman command sequence for a cleanup mode.
//
// Notes on podman 5.x behaviour (why the previous single commands were not
// enough):
//   - `podman builder prune` is just an alias of `podman image prune`, so the
//     old "prune" mode only removed *dangling* images and never touched the
//     tagged images produced by every build.
//   - `image prune -a` skips images still referenced by *build containers*
//     (buildah working containers left behind by failed/cancelled builds), so
//     intermediate layers stayed and the PVC filled up. `--external` is the
//     documented way to also remove images held by those build containers.
//   - `system prune --external` clears container data in storage that podman
//     itself no longer tracks (orphans from interrupted builds).
//
// prune = safe, keeps tagged/base image cache for fast builds.
// deep  = reclaim everything (all containers + all unused images incl. those
//
//	held by build containers + orphan data); base images are re-pulled
//	on the next build.
func cleanupCommands(mode string) [][]string {
	switch mode {
	case "prune":
		return [][]string{
			{"system", "prune", "-f"},
		}
	case "deep":
		return [][]string{
			{"rm", "-af"},                           // drop leftover build containers (they pin layers)
			{"image", "prune", "-af", "--external"}, // all unused images, incl. build-held
			{"system", "prune", "-f", "--external"}, // orphan container data / networks
		}
	default:
		return nil
	}
}

var reclaimedRe = regexp.MustCompile(`Total reclaimed space:\s*(\S+)`)

// parseReclaimed returns the last "Total reclaimed space: X" value, or "".
func parseReclaimed(output string) string {
	m := reclaimedRe.FindAllStringSubmatch(output, -1)
	if len(m) == 0 {
		return ""
	}
	return m[len(m)-1][1]
}

// runCleanup executes the command sequence for mode, tolerating individual
// step failures (deep clean is best-effort: one failing step must not stop the
// rest). It returns the combined output and an error only when every step
// failed.
func runCleanup(mode string) (string, error) {
	cmds := cleanupCommands(mode)
	if len(cmds) == 0 {
		return "", fmt.Errorf("unknown cleanup mode %q", mode)
	}
	var sb strings.Builder
	ok := 0
	for _, args := range cmds {
		cmd := exec.Command("docker", args...)
		out, err := cmd.CombinedOutput()
		fmt.Fprintf(&sb, "$ docker %s\n", strings.Join(args, " "))
		if text := strings.TrimSpace(string(out)); text != "" {
			sb.WriteString(text + "\n")
		}
		if err != nil {
			fmt.Fprintf(&sb, "(step failed: %v)\n", err)
			continue
		}
		ok++
	}
	if ok == 0 {
		return sb.String(), fmt.Errorf("all cleanup steps failed")
	}
	return sb.String(), nil
}

// hasActiveRun reports whether a build is currently running/pending. Cleanup
// must not run then: `rm -af` would kill an in-progress buildah container.
func (s *Server) hasActiveRun() bool {
	var n int64
	s.DB.DB.Model(&store.Run{}).
		Where("status IN ?", []string{"running", "pending"}).
		Count(&n)
	return n > 0
}

// cleanupStorage runs the requested cleanup, records it, and returns new usage
// plus the reclaimed-space string.
func (s *Server) cleanupStorage(mode string) ([]diskUsage, string, string, error) {
	if s.hasActiveRun() {
		return nil, "", "", fmt.Errorf("有构建正在运行，已跳过清理以免中断构建")
	}
	output, err := runCleanup(mode)
	reclaimed := parseReclaimed(output)
	if err != nil {
		return nil, output, reclaimed, err
	}
	now := time.Now()
	cfg := s.getAppConfig()
	cfg.LastCleanupAt = &now
	cfg.LastCleanupMode = mode
	if err := s.DB.DB.Save(cfg).Error; err != nil {
		return nil, output, reclaimed, err
	}
	return allUsage(), output, reclaimed, nil
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
	usage, output, reclaimed, err := s.cleanupStorage(req.Mode)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	s.audit(r, "storage.cleanup."+req.Mode, reclaimed)
	ok(w, map[string]interface{}{"usage": usage, "output": output, "reclaimed": reclaimed})
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
				if s.hasActiveRun() {
					continue // retry on the next tick once the build finishes
				}
				cfg := s.getAppConfig()
				log.Printf("storage: scheduled prune (frequency=%s)", cfg.CleanupFreq)
				if _, _, reclaimed, err := s.cleanupStorage("prune"); err != nil {
					log.Printf("storage: scheduled prune failed: %v", err)
					continue
				} else {
					log.Printf("storage: scheduled prune done (reclaimed %s)", reclaimed)
				}
				// escalate to deep only when usage is still high
				if pct := highestUsagePercent(); pct >= float64(cfg.CleanupPercent) {
					log.Printf("storage: usage %.1f%% still above threshold %d%%, running deep clean", pct, cfg.CleanupPercent)
					if _, _, reclaimed, err := s.cleanupStorage("deep"); err != nil {
						log.Printf("storage: scheduled deep clean failed: %v", err)
					} else {
						log.Printf("storage: scheduled deep clean done (reclaimed %s)", reclaimed)
					}
				}
			}
		}
	}()
}
