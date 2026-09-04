package api

import (
	"net/http"

	"navori/internal/store"
)

// audit records a write operation.
func (s *Server) audit(r *http.Request, action, target string) {
	username := ""
	if claims := claimsFrom(r); claims != nil {
		username = claims.Username
	}
	s.DB.DB.Create(&store.AuditLog{Username: username, Action: action, Target: target})
}

func (s *Server) listAuditLogs(w http.ResponseWriter, r *http.Request) {
	var logs []store.AuditLog
	s.DB.DB.Order("id desc").Limit(200).Find(&logs)
	out := make([]map[string]interface{}, 0, len(logs))
	for _, l := range logs {
		out = append(out, map[string]interface{}{
			"id": l.ID, "username": l.Username, "action": l.Action, "target": l.Target, "createdAt": l.CreatedAt,
		})
	}
	ok(w, out)
}
