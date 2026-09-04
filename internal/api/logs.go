package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"navori/internal/store"
)

// runLogs streams a run's step logs over SSE.
func (s *Server) runLogs(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "invalid id")
		return
	}
	var run store.Run
	if err := s.DB.DB.First(&run, id).Error; err != nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "run not found")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", "streaming unsupported")
		return
	}

	offsets := map[string]int64{}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		var steps []store.Step
		s.DB.DB.Where("run_id = ?", id).Order("step_order").Find(&steps)
		for _, st := range steps {
			if st.LogFile == "" {
				continue
			}
			off := offsets[st.LogFile]
			data, err := os.ReadFile(st.LogFile)
			if err != nil || int64(len(data)) <= off {
				continue
			}
			chunk := string(data[off:])
			offsets[st.LogFile] = int64(len(data))
			for _, line := range strings.Split(chunk, "\n") {
				if line != "" {
					payload, _ := json.Marshal(map[string]string{"step": st.Name, "line": line})
					fmt.Fprintf(w, "event: step\ndata: %s\n\n", payload)
				}
			}
		}
		flusher.Flush()

		var fresh store.Run
		s.DB.DB.First(&fresh, id)
		if fresh.Status == "success" || fresh.Status == "failed" || fresh.Status == "cancelled" || fresh.Status == "rejected" {
			payload, _ := json.Marshal(map[string]string{"status": fresh.Status})
			fmt.Fprintf(w, "event: end\ndata: %s\n\n", payload)
			flusher.Flush()
			return
		}

		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
