package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunPreflightCreatesWorkdirAndWarns(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", t.TempDir())
	workdir := filepath.Join(root, "agent")

	var out bytes.Buffer
	if err := runPreflight(agentConfig{Workdir: workdir}, &out, false); err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if _, err := os.Stat(workdir); err != nil {
		t.Fatalf("workdir not created: %v", err)
	}
	for _, want := range []string{"git", "kubectl", "docker"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("output %q missing warning for %s", out.String(), want)
		}
	}
}

func TestRunPreflightVerboseListsFoundTool(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	git := filepath.Join(bin, "git")
	if err := os.WriteFile(git, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)

	var out bytes.Buffer
	if err := runPreflight(agentConfig{Workdir: filepath.Join(root, "work")}, &out, true); err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if !strings.Contains(out.String(), git) {
		t.Errorf("verbose output %q does not contain %s", out.String(), git)
	}
}

func TestRunPreflightRejectsUnwritableWorkdir(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "not-a-dir")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := runPreflight(agentConfig{Workdir: file}, &bytes.Buffer{}, false); err == nil {
		t.Fatal("expected workdir error")
	}
}
