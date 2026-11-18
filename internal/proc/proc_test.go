//go:build unix

package proc

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestCancelKillsProcessGroup verifies that cancelling the context kills the
// shell's child, not only the shell itself.
func TestCancelKillsProcessGroup(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	ctx, cancel := context.WithCancel(context.Background())
	cmd := CommandContext(ctx, "sh", "-c", "sleep 30 & echo $! > "+pidFile+"; wait")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	var raw []byte
	for i := 0; i < 100; i++ {
		var err error
		raw, err = os.ReadFile(pidFile)
		if err == nil && strings.TrimSpace(string(raw)) != "" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	child, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		t.Fatalf("read child pid %q: %v", raw, err)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("command did not exit after cancel")
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(child, 0); err != nil {
			return // child gone
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("child %d survived process-group kill", child)
}
