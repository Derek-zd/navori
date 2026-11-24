// Package agentx defines the wire protocol shared by navori-server and
// navori-agent. It deliberately has no dependencies on the store or the
// execution engine so both sides can link it.
package agentx

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Protocol is the wire protocol version. Server and agent must agree exactly.
const Protocol = 1

// Server-side timing defaults (all leases are computed on the server).
const (
	DefaultHeartbeatSeconds = 15
	DefaultClaimWaitSeconds = 25
	DefaultMaxStepSeconds   = 3600
	DefaultLeaseSeconds     = 120
)

// HelloReq is sent by an agent on startup and after a reconnect.
type HelloReq struct {
	Version  string            `json:"version"`
	Labels   map[string]string `json:"labels,omitempty"`
	Host     string            `json:"host,omitempty"`
	Protocol int               `json:"protocol,omitempty"`
}

// HelloResp tells the agent how often to poll and which limits apply.
type HelloResp struct {
	Protocol         int       `json:"protocol"`
	Name             string    `json:"name"`
	ServerVersion    string    `json:"serverVersion"`
	HeartbeatSeconds int       `json:"heartbeatSeconds"`
	ClaimWaitSeconds int       `json:"claimWaitSeconds"`
	MaxStepSeconds   int       `json:"maxStepSeconds"`
	Now              time.Time `json:"now"`
}

// RunningStep describes a step the agent currently executes.
type RunningStep struct {
	StepID    uint      `json:"stepId"`
	RunID     uint      `json:"runId"`
	StartedAt time.Time `json:"startedAt"`
}

// DiskUsage is reported by the agent for display in the UI.
type DiskUsage struct {
	WorkspaceBytes int64 `json:"workspaceBytes"`
	ImagesBytes    int64 `json:"imagesBytes"`
}

// HeartbeatReq is sent every HelloResp.HeartbeatSeconds seconds.
type HeartbeatReq struct {
	Version string        `json:"version"`
	Running []RunningStep `json:"running,omitempty"`
	Disk    DiskUsage     `json:"disk,omitempty"`
}

// HeartbeatResp returns step ids the agent must cancel.
type HeartbeatResp struct {
	OK     bool   `json:"ok"`
	Cancel []uint `json:"cancel"`
}

// Job is one step handed to an agent. JobID is the steps.id.
type Job struct {
	JobID        uint            `json:"jobId"`
	Kind         string          `json:"kind,omitempty"` // empty/step | deploy-check
	RunID        uint            `json:"runId"`
	StepOrder    int             `json:"stepOrder"`
	StepName     string          `json:"stepName"`
	LeaseSeconds int             `json:"leaseSeconds"`
	Deadline     time.Time       `json:"deadline"`
	ImageTag     string          `json:"imageTag,omitempty"`
	Params       json.RawMessage `json:"params,omitempty"`
}

// DecodeParams unmarshals the step-specific payload into v.
func (j Job) DecodeParams(v any) error {
	if len(j.Params) == 0 {
		return fmt.Errorf("job %d has no params", j.JobID)
	}
	return json.Unmarshal(j.Params, v)
}

// PullParams is the payload for a pull step.
type PullParams struct {
	GitURL string `json:"gitUrl"`
	Branch string `json:"branch"`
	Dir    string `json:"dir"`
}

// BuildParams is the payload for a build step.
type BuildParams struct {
	Dir        string            `json:"dir"`
	Dockerfile string            `json:"dockerfile"`
	Context    string            `json:"context"`
	Args       map[string]string `json:"args,omitempty"`
	Platform   string            `json:"platform,omitempty"`
}

// PushParams is the payload for a push step. Credentials are short-lived and
// must never be written to the agent's disk.
type PushParams struct {
	Image           string `json:"image"`
	RegistryURL     string `json:"registryUrl"`
	Username        string `json:"username"`
	Password        string `json:"password"`
	InsecureSkipTLS bool   `json:"insecureSkipTLS"`
}

// DeployParams is the payload for a deploy step. Kubeconfig is base64-encoded
// and is written to a 0600 temporary file for the duration of the step only.
type DeployParams struct {
	Kubeconfig     string `json:"kubeconfig"`
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	Container      string `json:"container"`
	Image          string `json:"image"`
	TimeoutSeconds int    `json:"timeoutSeconds"`
}

// DeployCheckParams is a one-off kubectl connectivity check.
type DeployCheckParams struct {
	Kubeconfig     string `json:"kubeconfig"`
	Namespace      string `json:"namespace,omitempty"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty"`
}

// CheckResultReq is the agent result for a one-off check.
type CheckResultReq struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// LogChunk is a batch of log lines for one step.
type LogChunk struct {
	Seq   int64    `json:"seq"`
	Lines []string `json:"lines"`
}

// ResultReq is the terminal result of a step.
type ResultReq struct {
	Status   string `json:"status"` // success | failed | cancelled
	ExitCode *int   `json:"exitCode,omitempty"`
	Error    string `json:"error,omitempty"`
}

// MatchSelector reports whether labels satisfy every key=value pair in
// selector. An empty selector means "run locally" and never matches an agent.
// Malformed selectors or labels do not match.
func MatchSelector(selector, labels string) bool {
	want, err := ParseSelector(selector)
	if err != nil || len(want) == 0 {
		return false
	}
	have, err := ParseSelector(labels)
	if err != nil {
		return false
	}
	for k, v := range want {
		if got, ok := have[k]; !ok || got != v {
			return false
		}
	}
	return true
}

// AgentSelector returns the reserved selector for an individually addressed
// agent. Agent names are display-only; ids are stable and unambiguous.
func AgentSelector(agentID uint) string {
	return "agent=" + strconv.FormatUint(uint64(agentID), 10)
}

// MatchAgentSelector is MatchSelector plus a reserved agent=<id> key that
// matches the agent's database id. A user-supplied "agent" label is ignored.
func MatchAgentSelector(selector, labels string, agentID uint) bool {
	want, err := ParseSelector(selector)
	if err != nil || len(want) == 0 {
		return false
	}
	have, err := ParseSelector(labels)
	if err != nil {
		return false
	}
	id := strconv.FormatUint(uint64(agentID), 10)
	for k, v := range want {
		if k == "agent" {
			if v != id {
				return false
			}
			continue
		}
		if got, ok := have[k]; !ok || got != v {
			return false
		}
	}
	return true
}

// ParseSelector parses a comma-separated "k=v,k2=v2" label expression.
// Whitespace around keys and values is ignored. Empty input yields an empty
// map. Duplicate keys are rejected to keep routing unambiguous.
func ParseSelector(s string) (map[string]string, error) {
	out := map[string]string{}
	s = strings.TrimSpace(s)
	if s == "" {
		return out, nil
	}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil, fmt.Errorf("empty label in %q", s)
		}
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			return nil, fmt.Errorf("label %q is not key=value", part)
		}
		k := strings.TrimSpace(kv[0])
		v := strings.TrimSpace(kv[1])
		if k == "" || v == "" {
			return nil, fmt.Errorf("label %q has an empty key or value", part)
		}
		if _, dup := out[k]; dup {
			return nil, fmt.Errorf("duplicate label key %q", k)
		}
		out[k] = v
	}
	return out, nil
}

// NormalizeLabels canonicalizes a label expression to "k=v" pairs sorted by
// key. It is used by the admin API so stored labels are stable and easy to
// compare in the UI.
func NormalizeLabels(s string) (string, error) {
	pairs, err := ParseSelector(s)
	if err != nil {
		return "", err
	}
	if len(pairs) == 0 {
		return "", nil
	}
	keys := make([]string, 0, len(pairs))
	for k := range pairs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+pairs[k])
	}
	return strings.Join(parts, ","), nil
}
