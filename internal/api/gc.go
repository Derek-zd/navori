package api

import (
	"os"
	"path/filepath"
	"strconv"

	"navori/internal/store"
)

// gcRuns keeps the latest N runs for a pipeline and deletes the rest (steps + logs).
func (s *Server) gcRuns(pipelineID uint, retention int) {
	if retention <= 0 {
		return
	}
	var runs []store.Run
	s.DB.DB.Where("pipeline_id = ? AND status IN ?", pipelineID, []string{"success", "failed", "rejected", "cancelled"}).
		Order("id desc").Find(&runs)
	if len(runs) <= retention {
		return
	}
	for _, r := range runs[retention:] {
		s.DB.DB.Where("run_id = ?", r.ID).Delete(&store.Step{})
		os.RemoveAll(s.runLogDir(r.ID))
		var repoID uint
		s.DB.DB.Model(&store.Pipeline{}).Where("id = ?", r.PipelineID).Pluck("repo_id", &repoID)
		if repoID > 0 {
			os.RemoveAll(filepath.Join(s.Cfg.DataDir, "repos", strconv.FormatUint(uint64(repoID), 10), "runs", strconv.FormatUint(uint64(r.ID), 10)))
		}
		s.DB.DB.Delete(&store.Run{}, r.ID)
	}
}
