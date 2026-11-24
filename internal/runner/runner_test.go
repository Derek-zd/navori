package runner

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeCommand installs a shell script named name at the front of PATH and
// returns the directory plus a log file the script can append to.
func fakeCommand(t *testing.T, name, body string) (dir, logPath string) {
	t.Helper()
	dir = t.TempDir()
	logPath = filepath.Join(dir, "calls.log")
	script := "#!/bin/sh\nLOG=" + shellQuote(logPath) + "\n" + body
	if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return dir, logPath
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func TestBuildUsesIsolatedDockerConfigAndArgs(t *testing.T) {
	dir, calls := fakeCommand(t, "docker", `
echo "ARGS:$@" >> "$LOG"
echo "CWD:$(pwd)" >> "$LOG"
echo "CFG:$DOCKER_CONFIG" >> "$LOG"
cat "$DOCKER_CONFIG/config.json" >> "$LOG"
`)
	buildDir := filepath.Join(dir, "src")
	if err := os.MkdirAll(buildDir, 0o755); err != nil {
		t.Fatal(err)
	}
	realBuildDir, err := filepath.EvalSymlinks(buildDir)
	if err != nil {
		t.Fatal(err)
	}
	dockerConfig := filepath.Join(dir, "docker-config")
	var out bytes.Buffer
	err = Build(context.Background(), &out, BuildSpec{
		Dir:             buildDir,
		Dockerfile:      "Dockerfile.prod",
		Image:           "registry.example.com/app:1",
		Platform:        "linux/amd64",
		Args:            map[string]string{"VERSION": "1"},
		DockerConfigDir: dockerConfig,
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dockerConfig, "config.json"))
	if err != nil {
		t.Fatalf("config.json: %v", err)
	}
	if string(b) != `{"auths":{}}` {
		t.Fatalf("config.json = %s", b)
	}
	logged, _ := os.ReadFile(calls)
	text := string(logged)
	for _, want := range []string{
		"build -t registry.example.com/app:1 -f Dockerfile.prod --platform linux/amd64 --build-arg VERSION=1 .",
		"CWD:" + realBuildDir,
		"CFG:" + dockerConfig,
		`{"auths":{}}`,
	} {
		if !strings.Contains(text, want) {
			t.Errorf("docker call missing %q in:\n%s", want, text)
		}
	}
}

func TestPushUsesTemporaryCredentialConfig(t *testing.T) {
	_, calls := fakeCommand(t, "docker", `
echo "CFG:$DOCKER_CONFIG" >> "$LOG"
cat "$DOCKER_CONFIG/config.json" >> "$LOG"
`)
	var out bytes.Buffer
	if err := Push(context.Background(), &out, PushSpec{
		Image:       "registry.example.com/app:1",
		RegistryURL: "https://registry.example.com",
		Username:    "user",
		Password:    "secret",
	}); err != nil {
		t.Fatalf("Push: %v", err)
	}
	logged, _ := os.ReadFile(calls)
	text := string(logged)
	if !strings.Contains(text, `"auths"`) || !strings.Contains(text, "registry.example.com") {
		t.Fatalf("push did not use auth config:\n%s", text)
	}
	// The temporary config directory must be gone when Push returns.
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "CFG:") {
			cfg := strings.TrimPrefix(line, "CFG:")
			if cfg == "" || cfg == "." {
				t.Fatalf("push ran without DOCKER_CONFIG: %s", text)
			}
			if _, err := os.Stat(cfg); !os.IsNotExist(err) {
				t.Fatalf("temporary DOCKER_CONFIG %s still exists", cfg)
			}
		}
	}
}

func TestDeployZeroReplicasShortCircuits(t *testing.T) {
	_, calls := fakeCommand(t, "kubectl", `
echo "KUBECTL:$@" >> "$LOG"
if [ "$1" = "--kubeconfig" ]; then shift 2; fi
case "$1" in
  set) exit 0;;
  get) printf 0; exit 0;;
  rollout) exit 0;;
esac
`)
	var out bytes.Buffer
	err := Deploy(context.Background(), &out, DeploySpec{
		Kubeconfig: "apiVersion: v1\n",
		TargetName: "prod",
		Kind:       "Deployment",
		Name:       "web",
		Namespace:  "apps",
		Container:  "web",
		Image:      "registry.example.com/web:2",
		Timeout:    time.Minute,
	})
	if err != nil {
		t.Fatalf("Deploy: %v", err)
	}
	if !strings.Contains(out.String(), "副本数: 0") {
		t.Fatalf("missing zero-replica log:\n%s", out.String())
	}
	logged, _ := os.ReadFile(calls)
	if strings.Contains(string(logged), "rollout status") {
		t.Fatalf("zero-replica deploy waited for rollout:\n%s", logged)
	}
	if !strings.Contains(string(logged), "set image Deployment/web web=registry.example.com/web:2 -n apps") {
		t.Fatalf("unexpected set image call:\n%s", logged)
	}
}

func TestDeployRolloutFailureRollsBack(t *testing.T) {
	_, calls := fakeCommand(t, "kubectl", `
echo "KUBECTL:$@" >> "$LOG"
if [ "$1" = "--kubeconfig" ]; then shift 2; fi
case "$1" in
  set) exit 0;;
  get) printf 2; exit 0;;
  rollout)
    case "$2" in
      status) echo "rollout failed" >&2; exit 1;;
      undo) exit 0;;
    esac;;
esac
`)
	var out bytes.Buffer
	err := Deploy(context.Background(), &out, DeploySpec{
		Kubeconfig: "apiVersion: v1\n",
		Name:       "web",
		Namespace:  "apps",
		Container:  "web",
		Image:      "registry.example.com/web:3",
	})
	if err == nil {
		t.Fatal("expected rollout failure")
	}
	logged, _ := os.ReadFile(calls)
	if !strings.Contains(string(logged), "rollout undo Deployment/web -n apps") {
		t.Fatalf("missing rollback:\n%s", logged)
	}
	if !strings.Contains(out.String(), "deploy:\n  目标: web") {
		t.Fatalf("missing deploy header:\n%s", out.String())
	}
}

func gitRun(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestPullClonesThenFastForwards(t *testing.T) {
	src := t.TempDir()
	gitRun(t, src, "init", "-b", "main")
	gitRun(t, src, "config", "user.email", "test@example.com")
	gitRun(t, src, "config", "user.name", "test")
	if err := os.WriteFile(filepath.Join(src, "app.txt"), []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, src, "add", ".")
	gitRun(t, src, "commit", "-m", "v1")

	dir := filepath.Join(t.TempDir(), "checkout")
	var out bytes.Buffer
	if err := Pull(context.Background(), &out, PullSpec{GitURL: src, Branch: "main", Dir: dir}); err != nil {
		t.Fatalf("first pull: %v\n%s", err, out.String())
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "app.txt")); string(b) != "v1" {
		t.Fatalf("app.txt = %q", b)
	}

	if err := os.WriteFile(filepath.Join(src, "app.txt"), []byte("v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, src, "add", ".")
	gitRun(t, src, "commit", "-m", "v2")
	out.Reset()
	if err := Pull(context.Background(), &out, PullSpec{GitURL: src, Branch: "main", Dir: dir}); err != nil {
		t.Fatalf("second pull: %v\n%s", err, out.String())
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "app.txt")); string(b) != "v2" {
		t.Fatalf("app.txt after pull = %q", b)
	}
}

func TestCheckDeployUsesKubeconfigAndNamespace(t *testing.T) {
	_, calls := fakeCommand(t, "kubectl", `
echo "ARGS:$@" >> "$LOG"
if [ "$1" = "--kubeconfig" ]; then echo "CFG:$(cat "$2")" >> "$LOG"; fi
exit 0
`)
	if err := CheckDeploy(context.Background(), "apiVersion: v1\nkind: Config\n", "apps"); err != nil {
		t.Fatalf("CheckDeploy: %v", err)
	}
	logged, _ := os.ReadFile(calls)
	text := string(logged)
	if !strings.Contains(text, "--kubeconfig") || !strings.Contains(text, "get namespace apps --request-timeout=10s") {
		t.Fatalf("unexpected kubectl call:\n%s", text)
	}
	if !strings.Contains(text, "kind: Config") {
		t.Fatalf("kubeconfig content not written:\n%s", text)
	}
}
