package rules

import "testing"

func TestMatchGlob(t *testing.T) {
	cases := []struct {
		pattern, branch string
		want            bool
	}{
		{"main", "main", true},
		{"main", "develop", false},
		{"release/*", "release/v1", true},
		{"release/*", "release/v1/hotfix", false},
		{"release/**", "release/v1/hotfix", true},
		{"feature/*", "feature/login", true},
		{"*", "main", true},
		{"*", "feature/login", false},
		{"**", "feature/login", true},
		{"**", "main", true},
		{"v*", "v1.2.3", true},
		{"v*", "release/v1", false},
	}
	for _, c := range cases {
		if got := MatchGlob(c.pattern, c.branch); got != c.want {
			t.Errorf("MatchGlob(%q, %q) = %v, want %v", c.pattern, c.branch, got, c.want)
		}
	}
}

func TestMerge(t *testing.T) {
	defaults := map[string]interface{}{
		"dockerfilePath": "Dockerfile",
		"imageName":      "myapp",
		"tagTemplate":    "{branch}-{commit_short}",
		"deploy": map[string]interface{}{
			"kind":      "Deployment",
			"name":      "myapp",
			"namespace": "prod",
			"approval":  false,
		},
	}
	overrides := map[string]interface{}{
		"imageName": "myapp-release",
		"deploy": map[string]interface{}{
			"name":      "myapp-release",
			"namespace": "release",
		},
	}
	got := Merge(defaults, overrides)
	if got["imageName"] != "myapp-release" {
		t.Errorf("imageName = %v", got["imageName"])
	}
	if got["dockerfilePath"] != "Dockerfile" {
		t.Errorf("dockerfilePath should inherit: %v", got["dockerfilePath"])
	}
	d := got["deploy"].(map[string]interface{})
	if d["name"] != "myapp-release" || d["namespace"] != "release" {
		t.Errorf("deploy name/namespace overridden: %v", d)
	}
	if d["kind"] != "Deployment" || d["approval"] != false {
		t.Errorf("deploy kind/approval should inherit: %v", d)
	}
}

func TestResolve(t *testing.T) {
	defaults := map[string]interface{}{"imageName": "myapp"}
	rules := []Rule{
		{Branch: "release/*", Overrides: map[string]interface{}{"imageName": "myapp-release"}},
		{Branch: "**", Overrides: map[string]interface{}{"imageName": "myapp-default"}},
	}
	cfg, ok := Resolve(defaults, rules, "release/v1")
	if !ok || cfg["imageName"] != "myapp-release" {
		t.Errorf("release should match first rule: %v %v", ok, cfg)
	}
	cfg, ok = Resolve(defaults, rules, "feature/x")
	if !ok || cfg["imageName"] != "myapp-default" {
		t.Errorf("feature should match ** rule: %v %v", ok, cfg)
	}
	_, ok = Resolve(defaults, []Rule{{Branch: "release/*"}}, "feature/x")
	if ok {
		t.Errorf("feature should not match release/*")
	}
}
