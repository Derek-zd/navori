package api

import (
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
