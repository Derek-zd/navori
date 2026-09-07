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

func TestNormalizeRef(t *testing.T) {
	cases := []struct {
		ref, branch, want string
	}{
		{"refs/heads/main", "main", "refs/heads/main"}, // webhook/manual explicit ref passthrough
		{"refs/tags/v1.0", "v1.0", "refs/tags/v1.0"},   // tag ref passthrough
		{"", "main", "refs/heads/main"},                // manual/cron: derive from branch
		{"", "master", "refs/heads/master"},
		{"", "", ""}, // nothing known
	}
	for _, c := range cases {
		if got := normalizeRef(c.ref, c.branch); got != c.want {
			t.Errorf("normalizeRef(%q,%q) = %q, want %q", c.ref, c.branch, got, c.want)
		}
	}
}
