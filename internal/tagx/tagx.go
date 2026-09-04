package tagx

import (
	"fmt"
	"regexp"
	"strings"
)

// SanitizeBranch converts a branch name into a valid Docker tag component.
func SanitizeBranch(branch string) string {
	if branch == "" {
		return "branch"
	}
	var sb strings.Builder
	for _, r := range strings.ToLower(branch) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			sb.WriteRune(r)
		} else {
			sb.WriteRune('-')
		}
	}
	s := strings.Trim(sb.String(), ".-")
	if len(s) > 60 {
		s = s[:60]
	}
	if s == "" {
		return "branch"
	}
	return s
}

// Render replaces {var} placeholders in template using vars.
func Render(template string, vars map[string]string) (string, error) {
	result := template
	for k, v := range vars {
		result = strings.ReplaceAll(result, "{"+k+"}", v)
	}
	if i := strings.Index(result, "{"); i >= 0 {
		if j := strings.Index(result[i:], "}"); j > 0 {
			return "", fmt.Errorf("unresolved variable %s in tag template", result[i:i+j+1])
		}
	}
	return result, nil
}

var tagRe = regexp.MustCompile("^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$")

// Validate checks tag against Docker tag rules.
func Validate(tag string) error {
	if !tagRe.MatchString(tag) {
		return fmt.Errorf("invalid docker tag %q", tag)
	}
	return nil
}
