package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"navori/internal/agentx"
	"navori/internal/config"
	"navori/internal/store"
)

func newDispatchTestServer(t *testing.T) (*Server, *gorm.DB) {
	t.Helper()
	st, err := store.Open("sqlite", "", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	return &Server{DB: st, Cfg: &config.Config{DataDir: t.TempDir()}}, st.DB
}

func newRunFixture(t *testing.T, db *gorm.DB) (*store.Repository, *store.Run) {
	t.Helper()
	repo := store.Repository{Name: "repo-" + t.Name(), GitURL: "https://example.com/a.git", DefaultBranch: "main"}
	if err := db.Create(&repo).Error; err != nil {
		t.Fatal(err)
	}
	p := store.Pipeline{RepoID: repo.ID, ConfigJSON: "{}"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	run := store.Run{PipelineID: p.ID, Number: 1, TriggerType: "manual", Ref: "refs/heads/main", Status: "running", ImageTag: "reg.example.com/x:1", ConfigSnapshotJSON: `{"dockerfilePath":"Dockerfile"}`}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	return &repo, &run
}

func TestClaimStepMatchesSelector(t *testing.T) {
	s, db := newDispatchTestServer(t)
	repo, run := newRunFixture(t, db)
	step := store.Step{RunID: run.ID, StepOrder: 1, Name: "pull", Status: "queued", AgentSelector: "role=build,region=overseas"}
	if err := db.Create(&step).Error; err != nil {
		t.Fatal(err)
	}
	wrong := store.Agent{Name: "wrong", Labels: "region=overseas,role=deploy", TokenHash: "x"}
	agent := store.Agent{Name: "right", Labels: "region=overseas,role=build", TokenHash: "y"}
	db.Create(&wrong)
	db.Create(&agent)

	if job, found, err := s.claimStep(&wrong); err != nil || found || job != nil {
		t.Fatalf("wrong agent claimed: job=%v found=%v err=%v", job, found, err)
	}
	job, found, err := s.claimStep(&agent)
	if err != nil || !found || job == nil {
		t.Fatalf("claim: job=%v found=%v err=%v", job, found, err)
	}
	if job.StepName != "pull" || job.JobID != step.ID {
		t.Fatalf("unexpected job: %+v", job)
	}
	var p agentx.PullParams
	if err := job.DecodeParams(&p); err != nil {
		t.Fatal(err)
	}
	if p.Branch != "main" || p.GitURL != repo.GitURL || p.Dir != "workspace/"+strconv.FormatUint(uint64(repo.ID), 10) {
		t.Fatalf("unexpected pull params: %+v", p)
	}

	var got store.Step
	if err := db.First(&got, step.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Status != "running" || got.AgentID != agent.ID || got.LeaseExpiresAt == nil {
		t.Fatalf("step after claim: %+v", got)
	}
	if got.LeaseExpiresAt.Before(time.Now().UTC().Add(time.Minute)) {
		t.Fatalf("lease not renewed: %v", got.LeaseExpiresAt)
	}
}

func TestClaimStepMatchesAgentID(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	agent := store.Agent{Name: "US", Labels: "build=true", TokenHash: "x"}
	if err := db.Create(&agent).Error; err != nil {
		t.Fatal(err)
	}
	wrong := store.Agent{Name: "other", Labels: "build=true", TokenHash: "y"}
	db.Create(&wrong)
	step := store.Step{RunID: run.ID, StepOrder: 1, Name: "build", Status: "queued", AgentSelector: agentx.AgentSelector(agent.ID) + ",build=true"}
	if err := db.Create(&step).Error; err != nil {
		t.Fatal(err)
	}
	if _, found, err := s.claimStep(&wrong); err != nil || found {
		t.Fatalf("wrong agent claimed: found=%v err=%v", found, err)
	}
	if _, found, err := s.claimStep(&agent); err != nil || !found {
		t.Fatalf("addressed agent did not claim: found=%v err=%v", found, err)
	}
}

func TestExpireStepLeasesRequeuesThenFails(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	agent := store.Agent{Name: "a", TokenHash: "x"}
	db.Create(&agent)
	past := time.Now().UTC().Add(-time.Minute)
	step := store.Step{RunID: run.ID, StepOrder: 1, Name: "build", Status: "running", AgentID: agent.ID, AgentSelector: "role=build", LeaseExpiresAt: &past}
	db.Create(&step)

	for attempt := 1; attempt <= 2; attempt++ {
		s.expireStepLeases()
		var got store.Step
		db.First(&got, step.ID)
		if got.Status != "queued" || got.Attempt != attempt || got.AgentID != 0 || got.LeaseExpiresAt != nil {
			t.Fatalf("after expiry %d: %+v", attempt, got)
		}
		// Simulate the next agent claiming it and then disappearing again.
		db.Model(&store.Step{}).Where("id = ?", step.ID).Updates(map[string]interface{}{
			"status": "running", "agent_id": agent.ID, "lease_expires_at": &past,
		})
	}
	s.expireStepLeases()
	var got store.Step
	db.First(&got, step.ID)
	if got.Status != "failed" || got.Attempt != 3 || got.FinishedAt == nil {
		t.Fatalf("after max retries: %+v", got)
	}
}

func TestAgentJobResultIdempotent(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	agent := store.Agent{Name: "a", TokenHash: "x"}
	db.Create(&agent)
	step := store.Step{RunID: run.ID, StepOrder: 1, Name: "push", Status: "running", AgentID: agent.ID}
	db.Create(&step)

	h := chi.NewRouter()
	h.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), agentKey, &agent)))
		})
	})
	h.Post("/api/agent/jobs/{id}/result", s.agentJobResult)

	post := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/agent/jobs/"+strconv.FormatUint(uint64(step.ID), 10)+"/result", strings.NewReader(body))
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := post(`{"status":"success"}`); rec.Code != 200 {
		t.Fatalf("success result: %d %s", rec.Code, rec.Body.String())
	}
	var got store.Step
	db.First(&got, step.ID)
	if got.Status != "success" || got.FinishedAt == nil {
		t.Fatalf("step after result: %+v", got)
	}
	if rec := post(`{"status":"failed","error":"late"}`); rec.Code != 200 {
		t.Fatalf("duplicate result should be ignored, got %d", rec.Code)
	}
	db.First(&got, step.ID)
	if got.Status != "success" {
		t.Fatalf("late result overwrote terminal status: %+v", got)
	}
}

func TestDispatchStepCancelMarksCancelled(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	step := store.Step{RunID: run.ID, StepOrder: 1, Name: "pull", Status: "pending", AgentSelector: "role=build"}
	db.Create(&step)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.dispatchStep(ctx, &step); !errors.Is(err, context.Canceled) {
		t.Fatalf("dispatch err = %v, want context.Canceled", err)
	}
	var got store.Step
	db.First(&got, step.ID)
	if got.Status != "cancelled" {
		t.Fatalf("step status = %q, want cancelled", got.Status)
	}
}

func TestHeartbeatReturnsCancelForRequeuedStep(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	agent := store.Agent{Name: "a", TokenHash: "x"}
	db.Create(&agent)
	step := store.Step{RunID: run.ID, StepOrder: 1, Name: "build", Status: "cancelled", AgentID: agent.ID}
	db.Create(&step)

	body, _ := json.Marshal(agentx.HeartbeatReq{
		Running: []agentx.RunningStep{{StepID: step.ID, RunID: run.ID, StartedAt: time.Now()}},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/agent/heartbeat", strings.NewReader(string(body)))
	req = req.WithContext(context.WithValue(req.Context(), agentKey, &agent))
	rec := httptest.NewRecorder()
	s.agentHeartbeat(rec, req)
	if rec.Code != 200 {
		t.Fatalf("heartbeat: %d %s", rec.Code, rec.Body.String())
	}
	var resp agentx.HeartbeatResp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Cancel) != 1 || resp.Cancel[0] != step.ID {
		t.Fatalf("cancel list = %v, want [%d]", resp.Cancel, step.ID)
	}
}

func TestValidateExecution(t *testing.T) {
	valid := map[string]interface{}{
		"execution": map[string]interface{}{"buildAgent": "role=build,region=overseas", "deployAgent": ""},
	}
	if err := validateExecution(valid); err != nil {
		t.Fatalf("valid selector rejected: %v", err)
	}
	for _, bad := range []string{"role", "role=", "=build", "role=build,role=deploy", "role=build,,x=y"} {
		cfg := map[string]interface{}{"execution": map[string]interface{}{"buildAgent": bad}}
		if err := validateExecution(cfg); err == nil {
			t.Fatalf("selector %q should be rejected", bad)
		}
	}
}
