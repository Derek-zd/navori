package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
)

// runPreflight checks the local prerequisites an agent needs before it starts
// talking to the server. Missing tools are warnings rather than fatal errors:
// a build-only machine does not need kubectl, and an agent should still be
// able to report its status to the UI if one tool is temporarily unavailable.
// verbose is used by `-check`; startup only logs the workdir and warnings.
func runPreflight(cfg agentConfig, out io.Writer, verbose bool) error {
	if err := os.MkdirAll(cfg.Workdir, 0o755); err != nil {
		return fmt.Errorf("create workdir %s: %w", cfg.Workdir, err)
	}
	f, err := os.CreateTemp(cfg.Workdir, ".navori-write-test-*")
	if err != nil {
		return fmt.Errorf("workdir %s is not writable: %w", cfg.Workdir, err)
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	if verbose {
		fmt.Fprintf(out, "workdir   %s\n", cfg.Workdir)
	}

	missing := 0
	for _, tool := range []struct {
		name string
		hint string
	}{
		{"git", "pull/build 步骤需要 git"},
		{"kubectl", "deploy 步骤需要 kubectl"},
	} {
		path, err := exec.LookPath(tool.name)
		if err != nil {
			missing++
			fmt.Fprintf(out, "%-9s missing — %s\n", tool.name, tool.hint)
			continue
		}
		if verbose {
			fmt.Fprintf(out, "%-9s %s\n", tool.name, path)
		}
	}
	if path, err := exec.LookPath("docker"); err == nil {
		if verbose {
			fmt.Fprintf(out, "%-9s %s\n", "docker", path)
		}
	} else if path, err := exec.LookPath("podman"); err == nil {
		if verbose {
			fmt.Fprintf(out, "%-9s %s\n", "podman", path)
		}
	} else {
		missing++
		fmt.Fprintln(out, "docker    missing — build 步骤需要 docker 或 podman")
	}

	if missing > 0 && !verbose {
		fmt.Fprintf(out, "preflight: %d tool(s) missing; matching steps will fail until installed\n", missing)
	}
	return nil
}
