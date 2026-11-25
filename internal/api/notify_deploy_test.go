package api

import (
	"testing"

	"navori/internal/store"
)

func TestDeployEvent(t *testing.T) {
	s, db := newDispatchTestServer(t)
	_, run := newRunFixture(t, db)

	agent := store.Agent{Name: "xs-deploy", Status: "online", TokenHash: "t"}
	if err := db.Create(&agent).Error; err != nil {
		t.Fatal(err)
	}
	target := store.DeployTarget{Name: "xs-k8s", Type: "k8s", DefaultNamespace: "prod", AgentID: agent.ID}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	run.ConfigSnapshotJSON = `{"deploy":{"targetId":1,"kind":"Deployment","name":"webapp","namespace":""}}`
	if err := db.Save(run).Error; err != nil {
		t.Fatal(err)
	}
	step := store.Step{RunID: run.ID, StepOrder: 5, Name: "deploy", Status: "success", AgentID: agent.ID}
	if err := db.Create(&step).Error; err != nil {
		t.Fatal(err)
	}

	got := s.deployEvent(run)
	if got == nil {
		t.Fatal("expected deploy event")
	}
	want := map[string]string{
		"targetName": "xs-k8s",
		"kind":       "Deployment",
		"name":       "webapp",
		"namespace":  "prod",
		"status":     "success",
		"executor":   "xs-deploy",
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s = %v, want %v", k, got[k], v)
		}
	}

	// A rejected run keeps the deploy step skipped and carries the reason.
	step.Status = "skipped"
	db.Save(&step)
	run.Status = "rejected"
	run.RejectedReason = "审批拒绝"
	db.Save(run)
	got = s.deployEvent(run)
	if got["status"] != "skipped" || got["error"] != "审批拒绝" {
		t.Fatalf("unexpected skipped deploy: %v", got)
	}
}
