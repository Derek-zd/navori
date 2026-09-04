package api

import (
	"encoding/json"
	"testing"
)

func TestParseWebhookGeneric(t *testing.T) {
	payload := map[string]interface{}{
		"ref": "refs/heads/main", "commit": "abc123", "repoUrl": "https://gitlab.com/x/y.git",
	}
	body, _ := json.Marshal(payload)
	ref, commit, repoURL, ok := parseWebhook(body)
	if !ok || ref != "refs/heads/main" || commit != "abc123" || repoURL != "https://gitlab.com/x/y.git" {
		t.Fatalf("generic: %q %q %q %v", ref, commit, repoURL, ok)
	}
}

func TestParseWebhookGitLab(t *testing.T) {
	payload := map[string]interface{}{
		"object_kind":  "push",
		"ref":          "refs/heads/main",
		"checkout_sha": "abc123",
		"repository":   map[string]interface{}{"git_http_url": "https://gitlab.com/x/y.git"},
	}
	body, _ := json.Marshal(payload)
	ref, commit, repoURL, ok := parseWebhook(body)
	if !ok || ref != "refs/heads/main" || commit != "abc123" || repoURL != "https://gitlab.com/x/y.git" {
		t.Fatalf("gitlab: %q %q %q %v", ref, commit, repoURL, ok)
	}
}

func TestNormalizeGitURL(t *testing.T) {
	cases := []struct{ in, want string }{
		{"https://gitlab.com/x/y.git", "gitlab.com/x/y"},
		{"git@gitlab.com:x/y.git", "gitlab.com/x/y"},
		{"http://host/repo", "host/repo"},
	}
	for _, c := range cases {
		if got := normalizeGitURL(c.in); got != c.want {
			t.Errorf("normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
