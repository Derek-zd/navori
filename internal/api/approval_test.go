package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"navori/internal/auth"
	"navori/internal/store"
)

func approvalRequest(t *testing.T, runID uint, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", strconv.FormatUint(uint64(runID), 10))
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	ctx = context.WithValue(ctx, claimsKey, &auth.Claims{Username: "admin", Role: "admin"})
	return req.WithContext(ctx)
}

func TestApprovalDecisionPersistsAndIsIdempotent(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	db.Model(run).Updates(map[string]interface{}{"status": "awaiting_approval", "approval_required": true})
	step := store.Step{RunID: run.ID, StepOrder: 4, Name: "approve", Status: "awaiting_approval"}
	if err := db.Create(&step).Error; err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	s.approveRun(w, approvalRequest(t, run.ID, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("approve status=%d body=%s", w.Code, w.Body.String())
	}
	var got store.Run
	if err := db.First(&got, run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.ApprovalDecision != "approved" || got.ApprovedBy != "admin" || got.Status != "awaiting_approval" {
		t.Fatalf("run after decide: %+v", got)
	}

	w = httptest.NewRecorder()
	s.approveRun(w, approvalRequest(t, run.ID, ""))
	if w.Code != http.StatusConflict {
		t.Fatalf("second approve status=%d body=%s", w.Code, w.Body.String())
	}
	if err := db.First(&got, run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.ApprovalDecision != "approved" {
		t.Fatalf("decision overwritten: %+v", got)
	}
}

func TestReapInFlightLeavesAwaitingRun(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, awaiting := newRunFixture(t, db)
	db.Model(awaiting).Updates(map[string]interface{}{"status": "awaiting_approval"})
	approve := store.Step{RunID: awaiting.ID, StepOrder: 4, Name: "approve", Status: "awaiting_approval"}
	db.Create(&approve)

	var p store.Pipeline
	db.First(&p, awaiting.PipelineID)
	running := store.Run{PipelineID: p.ID, Number: 2, TriggerType: "manual", Ref: "refs/heads/main", Status: "running", ConfigSnapshotJSON: "{}"}
	db.Create(&running)
	runningStep := store.Step{RunID: running.ID, StepOrder: 1, Name: "build", Status: "running"}
	db.Create(&runningStep)

	s.ReapInFlight()

	var a, r store.Run
	db.First(&a, awaiting.ID)
	db.First(&r, running.ID)
	if a.Status != "awaiting_approval" {
		t.Fatalf("awaiting run reaped: %+v", a)
	}
	if r.Status != "failed" {
		t.Fatalf("running run not reaped: %+v", r)
	}
	var rs store.Step
	db.First(&rs, runningStep.ID)
	if rs.Status != "cancelled" || rs.LeaseExpiresAt != nil {
		t.Fatalf("running step after reap: %+v", rs)
	}
}

func TestResumeApprovedRunWithoutDeploy(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	db.Model(run).Updates(map[string]interface{}{"status": "awaiting_approval", "approval_decision": "approved"})
	step := store.Step{RunID: run.ID, StepOrder: 4, Name: "approve", Status: "awaiting_approval"}
	db.Create(&step)

	s.resumeAwaitingRun(run.ID)

	var got store.Run
	db.First(&got, run.ID)
	if got.Status != "success" {
		t.Fatalf("resumed run: %+v", got)
	}
	var st store.Step
	db.First(&st, step.ID)
	if st.Status != "success" {
		t.Fatalf("approve step: %+v", st)
	}
}

func TestResumeRejectedRun(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	db.Model(run).Updates(map[string]interface{}{"status": "awaiting_approval", "approval_decision": "rejected"})
	step := store.Step{RunID: run.ID, StepOrder: 4, Name: "approve", Status: "awaiting_approval"}
	db.Create(&step)

	s.resumeAwaitingRun(run.ID)

	var got store.Run
	db.First(&got, run.ID)
	if got.Status != "rejected" {
		t.Fatalf("resumed run: %+v", got)
	}
	var st store.Step
	db.First(&st, step.ID)
	if st.Status != "rejected" {
		t.Fatalf("approve step: %+v", st)
	}
}

func TestCancelAwaitingRun(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)
	db.Model(run).Updates(map[string]interface{}{"status": "awaiting_approval"})
	step := store.Step{RunID: run.ID, StepOrder: 4, Name: "approve", Status: "awaiting_approval"}
	db.Create(&step)
	deploy := store.Step{RunID: run.ID, StepOrder: 5, Name: "deploy", Status: "pending"}
	db.Create(&deploy)

	if !s.cancelAwaitingRun(run) {
		t.Fatal("cancelAwaitingRun returned false")
	}
	var got store.Run
	db.First(&got, run.ID)
	if got.Status != "cancelled" || got.FinishedAt == nil {
		t.Fatalf("run after cancel: %+v", got)
	}
	var st store.Step
	db.First(&st, step.ID)
	if st.Status != "cancelled" {
		t.Fatalf("approve step after cancel: %+v", st)
	}
	st = store.Step{}
	db.Where("id = ?", deploy.ID).First(&st)
	if st.Status != "skipped" {
		t.Fatalf("deploy step after cancel: %+v", st)
	}
}
