package deploy

import (
	"context"
	"io"
	"os/exec"
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
	full := append([]string{}, args...)
	if kubeconfig != "" {
		full = append([]string{"--kubeconfig", kubeconfig}, full...)
	}
	cmd := exec.CommandContext(ctx, "kubectl", full...)
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}
