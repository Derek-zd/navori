package api

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"navori/internal/store"
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

func TestWebhookBranchSkipReportsBranch(t *testing.T) {
	s, db := newDispatchTestServer(t)
	repo := store.Repository{Name: "app", GitURL: "https://github.com/acme/app.git", DefaultBranch: "main"}
	if err := db.Create(&repo).Error; err != nil {
		t.Fatal(err)
	}
	p := store.Pipeline{RepoID: repo.ID, ConfigJSON: "{}", BranchRulesJSON: `[{"branch":"main"}]`, WebhookToken: "tok"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	body := `{"ref":"refs/heads/dev","commit":"abcdef123456","repoUrl":"https://github.com/acme/app.git"}`
	req := httptest.NewRequest("POST", "/api/webhooks?token=tok", strings.NewReader(body))
	rec := httptest.NewRecorder()
	s.webhook(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data struct {
			Skipped bool   `json:"skipped"`
			Reason  string `json:"reason"`
			Branch  string `json:"branch"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Data.Skipped || resp.Data.Reason != "branch not matched" || resp.Data.Branch != "dev" {
		t.Fatalf("unexpected response: %+v", resp.Data)
	}
}

func TestWebhookRetryAfterTriggerError(t *testing.T) {
	s, db := newDispatchTestServer(t)
	repo := store.Repository{Name: "app2", GitURL: "https://github.com/acme/app2.git", DefaultBranch: "main"}
	if err := db.Create(&repo).Error; err != nil {
		t.Fatal(err)
	}
	p := store.Pipeline{
		RepoID:          repo.ID,
		ConfigJSON:      `{"execution":{"buildAgent":"role"}}`,
		BranchRulesJSON: `[{"branch":"main"}]`,
		WebhookToken:    "tok2",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	body := `{"ref":"refs/heads/main","commit":"abcdef123456","repoUrl":"https://github.com/acme/app2.git"}`
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("POST", "/api/webhooks?token=tok2", strings.NewReader(body))
		rec := httptest.NewRecorder()
		s.webhook(rec, req)
		if rec.Code != 500 {
			t.Fatalf("attempt %d status = %d, body = %s", i, rec.Code, rec.Body.String())
		}
	}
	var count int64
	if err := db.Model(&store.WebhookEvent{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed trigger left %d webhook event(s); retry would be deduplicated", count)
	}
}

func TestWebhookRetriesOrphanedDedupEvent(t *testing.T) {
	s, db := newDispatchTestServer(t)
	repo := store.Repository{Name: "app3", GitURL: "https://github.com/acme/app3.git", DefaultBranch: "main"}
	if err := db.Create(&repo).Error; err != nil {
		t.Fatal(err)
	}
	p := store.Pipeline{
		RepoID:          repo.ID,
		ConfigJSON:      "{}",
		BranchRulesJSON: `[{"branch":"main"}]`,
		WebhookToken:    "tok3",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	commit := "abcdef123456"
	// Simulate a dedup event left behind by an older failed trigger.
	if err := db.Create(&store.WebhookEvent{
		PipelineID:    p.ID,
		PayloadDigest: fmt.Sprintf("%d:%s", p.ID, commit),
	}).Error; err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"ref":"refs/heads/main","commit":%q,"repoUrl":"https://github.com/acme/app3.git"}`, commit)
	req := httptest.NewRequest("POST", "/api/webhooks?token=tok3", strings.NewReader(body))
	rec := httptest.NewRecorder()
	s.webhook(rec, req)
	if rec.Code != 202 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var count int64
	if err := db.Model(&store.Run{}).Where("pipeline_id = ? AND runs.`commit` = ?", p.ID, commit).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("run count = %d, want 1", count)
	}
}
