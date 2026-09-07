package gitx

import (
	"os"
	"os/exec"
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

func initRepo(t *testing.T, defaultBranch string) string {
	t.Helper()
	repo := t.TempDir()
	runGit(t, repo, "init", "-b", defaultBranch, ".")
	write(t, filepath.Join(repo, "README.md"), "hi")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init")
	return repo
}

func TestRemoteDefaultBranch(t *testing.T) {
	url := "file://" + initRepo(t, "master")
	got, err := RemoteDefaultBranch(url)
	if err != nil {
		t.Fatalf("RemoteDefaultBranch: %v", err)
	}
	if got != "master" {
		t.Errorf("default branch = %q, want master", got)
	}
}

func TestBranchExistsAndHead(t *testing.T) {
	repo := initRepo(t, "master")
	runGit(t, repo, "checkout", "-b", "main")
	url := "file://" + repo

	if ok, err := BranchExists(url, "main"); err != nil || !ok {
		t.Errorf("BranchExists(main) = %v, %v; want true", ok, err)
	}
	if ok, err := BranchExists(url, "nope"); err == nil || ok {
		t.Errorf("BranchExists(nope) = %v, %v; want false/error", ok, err)
	}
	sha, err := RemoteBranchHead(url, "main")
	if err != nil || sha == "" {
		t.Errorf("RemoteBranchHead(main) = %q, %v", sha, err)
	}
	if _, err := RemoteBranchHead(url, "nope"); err == nil {
		t.Error("RemoteBranchHead(nope) should error")
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
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
