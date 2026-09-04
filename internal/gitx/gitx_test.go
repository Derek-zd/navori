package gitx

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindDockerfile(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "Dockerfile"), "FROM alpine")
	got, err := FindDockerfile(root)
	if err != nil || got != "Dockerfile" {
		t.Fatalf("root: got %q err %v", got, err)
	}

	root2 := t.TempDir()
	write(t, filepath.Join(root2, "a", "b", "c", "Dockerfile"), "FROM alpine")
	got, err = FindDockerfile(root2)
	if err != nil || got != filepath.Join("a", "b", "c", "Dockerfile") {
		t.Fatalf("3 levels: got %q err %v", got, err)
	}

	root3 := t.TempDir()
	write(t, filepath.Join(root3, "a", "b", "c", "d", "Dockerfile"), "FROM alpine")
	if _, err = FindDockerfile(root3); err == nil {
		t.Fatalf("too deep should error")
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
