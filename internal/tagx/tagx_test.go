package tagx

import "testing"

func TestSanitizeBranch(t *testing.T) {
	cases := []struct{ in, want string }{
		{"main", "main"},
		{"Feature/Login_V2", "feature-login_v2"},
		{"release/v1.0", "release-v1.0"},
		{"", "branch"},
		{"中文分支", "branch"},
		{"feature/x.y_z-ok", "feature-x.y_z-ok"},
		{"...", "branch"},
	}
	for _, c := range cases {
		if got := SanitizeBranch(c.in); got != c.want {
			t.Errorf("SanitizeBranch(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSanitizeBranchTruncate(t *testing.T) {
	long := ""
	for i := 0; i < 70; i++ {
		long += "a"
	}
	got := SanitizeBranch(long)
	if len(got) != 60 {
		t.Errorf("truncate: got len %d, want 60", len(got))
	}
}

func TestRender(t *testing.T) {
	vars := map[string]string{
		"branch":         "main",
		"commit_short":   "abc1234",
		"timestamp":      "20260814-150405",
		"unix":           "1234567890",
		"build_number":   "42",
		"var.MY_VERSION": "v1.2.3",
	}
	cases := []struct{ in, want string }{
		{"{branch}-{commit_short}", "main-abc1234"},
		{"v1.2.3", "v1.2.3"},
		{"{var.MY_VERSION}", "v1.2.3"},
		{"{branch}-{commit_short}-{timestamp}", "main-abc1234-20260814-150405"},
		{"{branch}-{build_number}", "main-42"},
	}
	for _, c := range cases {
		got, err := Render(c.in, vars)
		if err != nil || got != c.want {
			t.Errorf("Render(%q) = %q err=%v, want %q", c.in, got, err, c.want)
		}
	}
}

func TestRenderUnresolved(t *testing.T) {
	_, err := Render("{branch}-{unknown}", map[string]string{"branch": "main"})
	if err == nil {
		t.Errorf("unresolved variable should error")
	}
}

func TestValidate(t *testing.T) {
	valid := []string{"main", "v1.2.3", "abc1234", "feature-login_v2", "x_y"}
	for _, tag := range valid {
		if err := Validate(tag); err != nil {
			t.Errorf("Validate(%q) should pass, got %v", tag, err)
		}
	}
	invalid := []string{".leading", "-leading", "has space", ""}
	for _, tag := range invalid {
		if err := Validate(tag); err == nil {
			t.Errorf("Validate(%q) should fail", tag)
		}
	}
}
