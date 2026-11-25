package notify

import (
	"strings"
	"testing"
)

func TestAgentEventFormatting(t *testing.T) {
	ev := Event{
		"event":       "agent.offline",
		"status":      "offline",
		"agentName":   "builder-overseas",
		"hostname":    "us-build-1",
		"agentLabels": "build=true,region=overseas",
		"version":     "0.1.0",
		"lastSeenAt":  "2026-11-24T03:00:00Z",
	}
	title, plain, md, ok := agentEvent(ev)
	if !ok {
		t.Fatal("expected agent event")
	}
	if !strings.Contains(title, "离线") || !strings.Contains(plain, "builder-overseas") {
		t.Fatalf("unexpected title/plain: %q / %q", title, plain)
	}
	if !strings.Contains(md, "**") || !strings.Contains(md, "region=overseas") {
		t.Fatalf("unexpected markdown: %q", md)
	}

	ev["event"] = "agent.online"
	ev["status"] = "online"
	title, plain, _, ok = agentEvent(ev)
	if !ok || !strings.Contains(title, "上线") || !strings.Contains(plain, "us-build-1") {
		t.Fatalf("unexpected online event: %q / %q", title, plain)
	}

	if _, _, _, ok := agentEvent(Event{"event": "run.finished"}); ok {
		t.Fatal("run events must not be treated as agent events")
	}
}

func TestDeployNotificationText(t *testing.T) {
	ev := Event{
		"pipelineId": uint(12),
		"deploy": map[string]interface{}{
			"targetName": "xs-k8s",
			"kind":       "Deployment",
			"name":       "webapp",
			"namespace":  "prod",
			"status":     "success",
			"executor":   "xs-deploy",
			"error":      "",
		},
	}
	text := deployNotificationText(ev)
	for _, want := range []string{"xs-k8s", "webapp", "Deployment", "prod", "xs-deploy", "成功"} {
		if !strings.Contains(text, want) {
			t.Fatalf("deploy text missing %q: %q", want, text)
		}
	}
	if eventUint(ev, "pipelineId") != 12 {
		t.Fatalf("pipelineId = %d", eventUint(ev, "pipelineId"))
	}

	ev["deploy"].(map[string]interface{})["status"] = "failed"
	ev["deploy"].(map[string]interface{})["error"] = "rollout failed"
	text = deployNotificationText(ev)
	if !strings.Contains(text, "失败") || !strings.Contains(text, "rollout failed") {
		t.Fatalf("failed deploy text: %q", text)
	}
}
