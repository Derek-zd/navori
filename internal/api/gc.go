package api

import (
	"os"

	"navori/internal/store"
)

// gcRuns keeps the latest N runs for a pipeline and deletes the rest (steps + logs).
func (s *Server) gcRuns(pipelineID uint, retention int) {
	if retention <= 0 {
		return
	}
	var runs []store.Run
	s.DB.DB.Where("pipeline_id = ?", pipelineID).Order("id desc").Find(&runs)
	if len(runs) <= retention {
		return
	}
	for _, r := range runs[retention:] {
		s.DB.DB.Where("run_id = ?", r.ID).Delete(&store.Step{})
		os.RemoveAll(s.runLogDir(r.ID))
		s.DB.DB.Delete(&store.Run{}, r.ID)
	}
}
