// Package cronutil provides a lightweight 5-field cron matcher.
package cronutil

import (
	"strconv"
	"strings"
	"time"
)

// Match reports whether a 5-field cron expression matches at time t.
// Fields: minute hour day month weekday (0-6, 0=Sunday).
// Supports *, */n, a-b, a,b,c and literal numbers.
func Match(expr string, t time.Time) bool {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return false
	}
	minute := t.Minute()
	hour := t.Hour()
	day := t.Day()
	month := int(t.Month())
	weekday := int(t.Weekday()) // 0=Sunday
	if !field(fields[0], minute, 0, 59) {
		return false
	}
	if !field(fields[1], hour, 0, 23) {
		return false
	}
	if !field(fields[2], day, 1, 31) {
		return false
	}
	if !field(fields[3], month, 1, 12) {
		return false
	}
	if !field(fields[4], weekday, 0, 6) {
		return false
	}
	return true
}

func field(f string, value, min, max int) bool {
	for _, part := range strings.Split(f, ",") {
		part = strings.TrimSpace(part)
		if part == "*" {
			return true
		}
		if strings.HasPrefix(part, "*/") {
			n, err := strconv.Atoi(strings.TrimPrefix(part, "*/"))
			if err == nil && n > 0 && value%n == 0 {
				return true
			}
			continue
		}
		if strings.Contains(part, "-") {
			segs := strings.SplitN(part, "-", 2)
			lo, eins := strconv.Atoi(segs[0])
			hi, e2 := strconv.Atoi(segs[1])
			if eins == nil && e2 == nil && value >= lo && value <= hi {
				return true
			}
			continue
		}
		n, err := strconv.Atoi(part)
		if err == nil && n == value {
			return true
		}
	}
	return false
}
