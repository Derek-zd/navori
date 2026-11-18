//go:build !unix

package proc

import (
	"context"
	"os/exec"
)

// CommandContext falls back to exec.CommandContext on platforms without POSIX
// process groups.
func CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

// Configure is a no-op on platforms without POSIX process groups.
func Configure(cmd *exec.Cmd) {}
