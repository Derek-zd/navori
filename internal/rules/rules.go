package rules

import (
	"regexp"
	"strings"
)

// MatchGlob reports whether branch matches pattern.
// * matches within a path segment; ** matches across segments (including /).
func MatchGlob(pattern, branch string) bool {
	re, err := compileGlob(pattern)
	if err != nil {
		return false
	}
	return re.MatchString(branch)
}

func compileGlob(pattern string) (*regexp.Regexp, error) {
	var sb strings.Builder
	sb.WriteString("^")
	for i := 0; i < len(pattern); i++ {
		c := pattern[i]
		switch c {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				sb.WriteString(".*")
				i++
			} else {
				sb.WriteString("[^/]*")
			}
		case '?':
			sb.WriteString("[^/]")
		default:
			sb.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	sb.WriteString("$")
	return regexp.Compile(sb.String())
}

// Merge shallow-merges overrides into defaults. The "deploy" key is merged one level deep.
func Merge(defaults, overrides map[string]interface{}) map[string]interface{} {
	out := copyMap(defaults)
	for k, v := range overrides {
		if k == "deploy" {
			out["deploy"] = mergeDeploy(out["deploy"], v)
		} else {
			out[k] = v
		}
	}
	return out
}

func mergeDeploy(d, o interface{}) map[string]interface{} {
	merged := copyMap(toMap(d))
	for k, v := range toMap(o) {
		merged[k] = v
	}
	return merged
}

func copyMap(m map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func toMap(v interface{}) map[string]interface{} {
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	return map[string]interface{}{}
}

// Rule is a branch rule: a branch glob plus overrides applied on top of defaults.
type Rule struct {
	Branch    string                 `json:"branch"`
	Overrides map[string]interface{} `json:"overrides"`
}

// Resolve returns the effective config for branch and whether any rule matched.
// Rules are evaluated in order; the first match wins.
func Resolve(defaults map[string]interface{}, rules []Rule, branch string) (map[string]interface{}, bool) {
	for _, r := range rules {
		if MatchGlob(r.Branch, branch) {
			return Merge(defaults, r.Overrides), true
		}
	}
	return nil, false
}
