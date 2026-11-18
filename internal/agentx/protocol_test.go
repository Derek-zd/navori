package agentx

import (
	"encoding/json"
	"testing"
	"time"
)

func TestMatchSelector(t *testing.T) {
	cases := []struct {
		name     string
		selector string
		labels   string
		want     bool
	}{
		{"empty selector never matches", "", "role=build", false},
		{"empty labels", "role=build", "", false},
		{"single label", "role=build", "role=build", true},
		{"single label mismatch", "role=build", "role=deploy", false},
		{"multiple labels", "role=build,region=overseas", "role=build,region=overseas", true},
		{"subset of labels", "role=build", "role=build,region=overseas", true},
		{"one of many missing", "role=build,site=xiaoshan", "role=build,region=overseas", false},
		{"whitespace is trimmed", " role = build , region = overseas ", "role=build,region=overseas", true},
		{"labels whitespace is trimmed", "role=build", " role = build ", true},
		{"value containing equals", "url=a=b", "url=a=b", true},
		{"malformed selector", "role", "role=build", false},
		{"empty value", "role=", "role=", false},
		{"empty key", "=build", "=build", false},
		{"duplicate selector key", "role=build,role=deploy", "role=build", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := MatchSelector(tc.selector, tc.labels); got != tc.want {
				t.Fatalf("MatchSelector(%q, %q) = %v, want %v", tc.selector, tc.labels, got, tc.want)
			}
		})
	}
}

func TestNormalizeLabels(t *testing.T) {
	got, err := NormalizeLabels(" region = overseas , role = build ")
	if err != nil {
		t.Fatalf("NormalizeLabels: %v", err)
	}
	if got != "region=overseas,role=build" {
		t.Fatalf("NormalizeLabels = %q, want %q", got, "region=overseas,role=build")
	}
	if got, err := NormalizeLabels("  "); err != nil || got != "" {
		t.Fatalf("NormalizeLabels(empty) = %q, %v", got, err)
	}
	if _, err := NormalizeLabels("role"); err == nil {
		t.Fatal("NormalizeLabels accepted a malformed expression")
	}
}

func TestJobJSONRoundTrip(t *testing.T) {
	deadline := time.Date(2026, 11, 18, 3, 0, 0, 0, time.UTC)
	params, err := json.Marshal(BuildParams{
		Dir:        "/workspace/1",
		Dockerfile: "Dockerfile",
		Context:    ".",
		Args:       map[string]string{"A": "1"},
		Platform:   "linux/amd64",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := Job{
		JobID:        812,
		RunID:        88,
		StepOrder:    2,
		StepName:     "build",
		LeaseSeconds: 120,
		Deadline:     deadline,
		ImageTag:     "gh/tmt:main-e410be4",
		Params:       params,
	}
	b, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var got Job
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.JobID != want.JobID || got.RunID != want.RunID || got.StepName != want.StepName ||
		got.LeaseSeconds != want.LeaseSeconds || !got.Deadline.Equal(want.Deadline) || got.ImageTag != want.ImageTag {
		t.Fatalf("job round trip mismatch: %+v != %+v", got, want)
	}
	var bp BuildParams
	if err := got.DecodeParams(&bp); err != nil {
		t.Fatal(err)
	}
	if bp.Dir != "/workspace/1" || bp.Args["A"] != "1" || bp.Platform != "linux/amd64" {
		t.Fatalf("params round trip mismatch: %+v", bp)
	}
}

func TestProtocolJSONShapes(t *testing.T) {
	hello, err := json.Marshal(HelloReq{
		Version:  "0.1.0",
		Labels:   map[string]string{"role": "build", "region": "overseas"},
		Host:     "build-01",
		Protocol: Protocol,
	})
	if err != nil {
		t.Fatal(err)
	}
	var h map[string]any
	if err := json.Unmarshal(hello, &h); err != nil {
		t.Fatal(err)
	}
	if _, ok := h["name"]; ok {
		t.Fatalf("hello request should not carry name: %s", hello)
	}

	resp, err := json.Marshal(HelloResp{Protocol: Protocol, Name: "overseas-build-1"})
	if err != nil {
		t.Fatal(err)
	}
	var hr map[string]any
	if err := json.Unmarshal(resp, &hr); err != nil {
		t.Fatal(err)
	}
	if hr["name"] != "overseas-build-1" {
		t.Fatalf("hello response json = %s", resp)
	}

	hb, err := json.Marshal(HeartbeatResp{OK: true, Cancel: []uint{}})
	if err != nil {
		t.Fatal(err)
	}
	if string(hb) != `{"ok":true,"cancel":[]}` {
		t.Fatalf("heartbeat json = %s", hb)
	}

	res, err := json.Marshal(ResultReq{Status: "failed", ExitCode: intPtr(1), Error: "boom"})
	if err != nil {
		t.Fatal(err)
	}
	var r map[string]any
	if err := json.Unmarshal(res, &r); err != nil {
		t.Fatal(err)
	}
	if r["status"] != "failed" || r["exitCode"].(float64) != 1 || r["error"] != "boom" {
		t.Fatalf("result json = %s", res)
	}
}

func intPtr(v int) *int { return &v }
