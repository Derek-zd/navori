package deploy

import "testing"

func TestParseReplicas(t *testing.T) {
	cases := []struct {
		name string
		out  string
		want int
		ok   bool
	}{
		{"zero", "0", 0, true},
		{"one", "1", 1, true},
		{"three", "3", 3, true},
		{"whitespace", "  2  ", 2, true},
		{"empty", "", 0, false},
		{"garbage", "abc", 0, false},
		{"null from jsonpath", "null", 0, false},
	}
	for _, c := range cases {
		got, ok := parseReplicas(c.out)
		if got != c.want || ok != c.ok {
			t.Errorf("%s: parseReplicas(%q) = %d,%v want %d,%v", c.name, c.out, got, ok, c.want, c.ok)
		}
	}
}
