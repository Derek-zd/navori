package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"navori/internal/store"
)

func (s *Server) webhook(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	ref, commit, repoURL, valid := parseWebhook(body)
	if !valid {
		fail(w, http.StatusBadRequest, "E_VALIDATION", "unrecognized webhook payload")
		return
	}

	repo, pipeline := s.findByRepoURL(repoURL)
	if pipeline == nil {
		fail(w, http.StatusNotFound, "E_NOT_FOUND", "no pipeline for this repository")
		return
	}

	token := r.Header.Get("X-Navori-Token")
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token == "" || token != pipeline.WebhookToken {
		fail(w, http.StatusUnauthorized, "E_UNAUTHORIZED", "invalid webhook token")
		return
	}

	branch := stripRef(ref)
	config, matched := s.resolveForBranch(pipeline, repo, branch)
	if !matched {
		ok(w, map[string]interface{}{"skipped": true, "reason": "branch not matched"})
		return
	}

	run, skipped, err := s.triggerWebhook(pipeline, repo, ref, branch, commit, config)
	if err != nil {
		fail(w, http.StatusInternalServerError, "E_INTERNAL", err.Error())
		return
	}
	if skipped {
		ok(w, map[string]interface{}{"skipped": true, "reason": "duplicate commit"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]interface{}{"data": map[string]interface{}{"runId": run.ID, "number": run.Number}})
}

func parseWebhook(body []byte) (ref, commit, repoURL string, ok bool) {
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		return "", "", "", false
	}
	// GitLab push event
	if m["object_kind"] == "push" {
		ref, _ = m["ref"].(string)
		commit, _ = m["checkout_sha"].(string)
		if commit == "" {
			commit, _ = m["after"].(string)
		}
		if repo, ok2 := m["repository"].(map[string]interface{}); ok2 {
			repoURL, _ = repo["git_http_url"].(string)
		}
		return ref, commit, repoURL, ref != "" && commit != ""
	}
	// generic format
	ref, _ = m["ref"].(string)
	commit, _ = m["commit"].(string)
	repoURL, _ = m["repoUrl"].(string)
	return ref, commit, repoURL, ref != "" && commit != ""
}

func stripRef(ref string) string {
	for _, p := range []string{"refs/heads/", "refs/tags/"} {
		if strings.HasPrefix(ref, p) {
			return strings.TrimPrefix(ref, p)
		}
	}
	return ref
}

func normalizeGitURL(u string) string {
	s := strings.TrimSpace(u)
	s = strings.TrimSuffix(s, "/")
	s = strings.TrimSuffix(s, ".git")
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if strings.HasPrefix(s, "git@") {
		s = strings.TrimPrefix(s, "git@")
		s = strings.Replace(s, ":", "/", 1)
	}
	return strings.ToLower(s)
}

func (s *Server) findByRepoURL(repoURL string) (*store.Repository, *store.Pipeline) {
	norm := normalizeGitURL(repoURL)
	if norm == "" {
		return nil, nil
	}
	var repos []store.Repository
	s.DB.DB.Find(&repos)
	for i := range repos {
		if normalizeGitURL(repos[i].GitURL) == norm {
			var p store.Pipeline
			if err := s.DB.DB.Where("repo_id = ?", repos[i].ID).First(&p).Error; err == nil {
				return &repos[i], &p
			}
		}
	}
	return nil, nil
}
