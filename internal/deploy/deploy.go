package deploy

import (
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"navori/internal/proc"
)

// Target describes a K8s workload to update.
type Target struct {
	Kubeconfig string
	Kind       string
	Name       string
	Namespace  string
	Container  string
	Image      string
}

// SetImage updates the workload's container image.
func SetImage(ctx context.Context, w io.Writer, t Target) error {
	args := []string{"set", "image", t.Kind + "/" + t.Name, t.Container + "=" + t.Image}
	if t.Namespace != "" {
		args = append(args, "-n", t.Namespace)
	}
	return run(ctx, w, t.Kubeconfig, args...)
}

// Replicas returns the workload's desired replica count. Kinds without a
// spec.replicas field (DaemonSet, Job, CronJob) yield 1, and a workload that
// cannot be queried also falls back to 1 so callers keep the normal rollout
// behaviour unless a real 0-replica workload is detected.
func Replicas(ctx context.Context, w io.Writer, t Target) (int, error) {
	args := []string{"get", t.Kind + "/" + t.Name, "-o", "jsonpath={.spec.replicas}"}
	if t.Namespace != "" {
		args = append(args, "-n", t.Namespace)
	}
	cmd := proc.CommandContext(ctx, "kubectl", buildArgs(t.Kubeconfig, args...)...)
	cmd.Stderr = w // stdout captured via Output for the replica count
	out, err := cmd.Output()
	if err != nil {
		// unknown kind / not found etc: treat as normal (1) to preserve
		// existing rollout behaviour; the error is already visible in the log
		return 1, nil
	}
	n, ok := parseReplicas(string(out))
	if !ok {
		return 1, nil // no spec.replicas / unparsable -> not a scaled workload
	}
	return n, nil
}

// parseReplicas parses the kubectl jsonpath output for spec.replicas.
// ok=false means "no usable replica count" (empty, or kind without replicas).
func parseReplicas(out string) (int, bool) {
	s := strings.TrimSpace(out)
	if s == "" {
		return 0, false
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return n, true
}

// RolloutStatus waits for the rollout to complete.
func RolloutStatus(ctx context.Context, w io.Writer, t Target, timeout string) error {
	args := []string{"rollout", "status", t.Kind + "/" + t.Name}
	if t.Namespace != "" {
		args = append(args, "-n", t.Namespace)
	}
	if timeout != "" {
		args = append(args, "--timeout="+timeout)
	}
	return run(ctx, w, t.Kubeconfig, args...)
}

// RolloutUndo reverts to the previous revision.
func RolloutUndo(ctx context.Context, w io.Writer, t Target) error {
	args := []string{"rollout", "undo", t.Kind + "/" + t.Name}
	if t.Namespace != "" {
		args = append(args, "-n", t.Namespace)
	}
	return run(ctx, w, t.Kubeconfig, args...)
}

// CheckKubeconfig verifies connectivity by listing namespaces.
func CheckKubeconfig(ctx context.Context, w io.Writer, kubeconfig string) error {
	return run(ctx, w, kubeconfig, "get", "ns")
}

func run(ctx context.Context, w io.Writer, kubeconfig string, args ...string) error {
	cmd := proc.CommandContext(ctx, "kubectl", buildArgs(kubeconfig, args...)...)
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}

func buildArgs(kubeconfig string, args ...string) []string {
	if kubeconfig == "" {
		return args
	}
	full := []string{"--kubeconfig", kubeconfig}
	return append(full, args...)
}

// Check verifies that the kubeconfig can reach the cluster. It writes the
// kubeconfig to a 0600 temporary file and removes it immediately afterwards.
func Check(ctx context.Context, kubeconfig, namespace string) error {
	if strings.TrimSpace(kubeconfig) == "" {
		return fmt.Errorf("kubeconfig is empty")
	}
	f, err := os.CreateTemp("", "navori-check-*.yaml")
	if err != nil {
		return err
	}
	path := f.Name()
	defer os.Remove(path)
	if _, err := f.WriteString(kubeconfig); err != nil {
		f.Close()
		return err
	}
	f.Close()
	if err := os.Chmod(path, 0o600); err != nil {
		return err
	}
	args := []string{"get", "namespaces", "--request-timeout=10s"}
	if strings.TrimSpace(namespace) != "" {
		args = []string{"get", "namespace", namespace, "--request-timeout=10s"}
	}
	cmd := proc.CommandContext(ctx, "kubectl", buildArgs(path, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("kubectl %s: %s", strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return nil
}
