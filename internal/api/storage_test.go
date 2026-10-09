package api

import (
	"strings"
	"testing"
	"time"
)

func TestCleanupDue(t *testing.T) {
	now := time.Now()
	h := time.Hour
	past := func(d time.Duration) *time.Time {
		t := now.Add(-d)
		return &t
	}

	cases := []struct {
		name string
		last *time.Time
		freq string
		now  time.Time
		want bool
	}{
		{"off never", past(3 * 24 * h), "off", now, false},
		{"nil first run", nil, "daily", now, true},
		{"daily due", past(25 * h), "daily", now, true},
		{"daily not due", past(2 * h), "daily", now, false},
		{"weekly due", past(8 * 24 * h), "weekly", now, true},
		{"weekly not due", past(3 * 24 * h), "weekly", now, false},
		{"monthly due", past(31 * 24 * h), "monthly", now, true},
		{"monthly not due", past(10 * 24 * h), "monthly", now, false},
		{"unknown freq never", past(100 * 24 * h), "hourly", now, false},
	}
	for _, c := range cases {
		if got := cleanupDue(c.last, c.freq, c.now); got != c.want {
			t.Errorf("%s: cleanupDue = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestRound1(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{0.04, 0.0},
		{0.05, 0.1},
		{12.34, 12.3},
		{99.96, 100.0},
		{7.0, 7.0},
	}
	for _, c := range cases {
		if got := round1(c.in); got != c.want {
			t.Errorf("round1(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestCleanupCommands(t *testing.T) {
	// deep must include the --external variants: plain `image prune -a` skips
	// images pinned by leftover buildah build containers, which is exactly why
	// the PVC filled up before.
	deep := cleanupCommands("deep")
	if len(deep) == 0 {
		t.Fatal("deep: no commands")
	}
	var joined []string
	for _, c := range deep {
		joined = append(joined, strings.Join(c, " "))
	}
	all := strings.Join(joined, " | ")
	for _, want := range []string{"rm -af", "image prune -af --external", "system prune -f --external"} {
		if !strings.Contains(all, want) {
			t.Errorf("deep missing %q, got: %s", want, all)
		}
	}

	prune := cleanupCommands("prune")
	if len(prune) != 1 || strings.Join(prune[0], " ") != "system prune -f" {
		t.Errorf("prune = %v, want [[system prune -f]]", prune)
	}

	if cleanupCommands("bogus") != nil {
		t.Error("bogus mode should return nil")
	}
}

func TestParseReclaimed(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Deleted Images\nTotal reclaimed space: 3.372GB\n", "3.372GB"},
		{"Total reclaimed space: 0B", "0B"},
		{"$ docker system prune -f\nTotal reclaimed space: 1.5MB\n$ docker image prune -af --external\nTotal reclaimed space: 700MB\n", "700MB"},
		{"no marker here", ""},
	}
	for _, c := range cases {
		if got := parseReclaimed(c.in); got != c.want {
			t.Errorf("parseReclaimed(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
