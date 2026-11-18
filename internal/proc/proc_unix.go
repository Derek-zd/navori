//go:build unix

// Package proc configures child processes so cancelling a step also kills the
// whole process group (docker build, kubectl, ...), not just the leader.
package proc

import (
	"context"
	"os/exec"
	"syscall"
)

// CommandContext is exec.CommandContext with a process-group cancel.
func CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	Configure(cmd)
	return cmd
}

// Configure puts cmd in its own process group and replaces the default
// context cancel with a group kill.
func Configure(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
