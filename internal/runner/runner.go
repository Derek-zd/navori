// Package runner executes individual pipeline steps from literal parameters.
// It never reads the database or server configuration, so the same code runs
// locally on the server and remotely inside an agent.
package runner

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"navori/internal/buildx"
	"navori/internal/deploy"
	"navori/internal/gitx"
)

// PullSpec describes a git checkout/update into Dir.
type PullSpec struct {
	GitURL string
	Branch string
	Dir    string
}

// BuildSpec describes an image build.
type BuildSpec struct {
	Dir             string
	Dockerfile      string
	Image           string
	Platform        string
	Args            map[string]string
	DockerConfigDir string
}

// PushSpec describes pushing Image to a registry. Credentials are written to
// a temporary DOCKER_CONFIG directory and never to the host config.
type PushSpec struct {
	Image           string
	RegistryURL     string
	Username        string
	Password        string
	InsecureSkipTLS bool
}

// DeploySpec describes a kubectl image update. TargetName is only used in the
// log output; Kubeconfig is the literal kubeconfig content.
type DeploySpec struct {
	Kubeconfig string
	TargetName string
	Kind       string
	Name       string
	Namespace  string
	Container  string
	Image      string
	Timeout    time.Duration
}

// Pull clones the repository on first use and otherwise checks out the branch
// and fast-forwards it.
func Pull(ctx context.Context, w io.Writer, sp PullSpec) error {
	fmt.Fprintf(w, "branch=%s\n", sp.Branch)

	if _, err := os.Stat(filepath.Join(sp.Dir, ".git")); err != nil {
		if err := gitx.CloneW(sp.Dir, sp.GitURL, sp.Branch, w); err != nil {
			return err
		}
		if sp.Branch != "" {
			if err := gitx.CheckoutW(sp.Dir, sp.Branch, w); err != nil {
				return err
			}
		}
	} else {
		if err := gitx.CheckoutW(sp.Dir, sp.Branch, w); err != nil {
			return err
		}
		if err := gitx.PullW(sp.Dir, w); err != nil {
			return err
		}
	}
	if hc, err := gitx.HeadCommit(sp.Dir); err == nil {
		fmt.Fprintf(w, "HEAD commit: %s\n", hc)
	}
	return nil
}

// Build builds an image with an isolated, empty docker config unless the
// caller already provided one (push credentials are never reused here).
func Build(ctx context.Context, w io.Writer, sp BuildSpec) error {
	dir := sp.DockerConfigDir
	if dir == "" {
		var err error
		dir, err = os.MkdirTemp("", "navori-docker-*")
		if err != nil {
			return err
		}
		defer os.RemoveAll(dir)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	configPath := filepath.Join(dir, "config.json")
	if _, err := os.Stat(configPath); err != nil {
		if err := os.WriteFile(configPath, []byte("{\"auths\":{}}"), 0o600); err != nil {
			return err
		}
	}
	return buildx.Build(ctx, w, sp.Dir, sp.Dockerfile, sp.Image, sp.Platform, sp.Args, dir)
}

// Push pushes the image, using a temporary DOCKER_CONFIG when credentials are
// present and removing it afterwards.
func Push(ctx context.Context, w io.Writer, sp PushSpec) error {
	if sp.Username == "" {
		return buildx.Push(ctx, w, sp.Image, "")
	}
	configDir, err := buildx.WriteAuthConfig(sp.RegistryURL, sp.Username, sp.Password)
	if err != nil {
		return err
	}
	defer os.RemoveAll(configDir)
	return buildx.Push(ctx, w, sp.Image, configDir)
}

// Deploy updates the workload image. Scaled-to-zero workloads have no rollout
// to wait for; every other workload waits for the rollout and rolls back on
// failure.
func Deploy(ctx context.Context, w io.Writer, sp DeploySpec) error {
	path, err := writeTempKubeconfig(sp.Kubeconfig)
	if err != nil {
		return err
	}
	defer os.Remove(path)

	kind := sp.Kind
	if kind == "" {
		kind = "Deployment"
	}
	timeout := sp.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}
	targetName := sp.TargetName
	if targetName == "" {
		targetName = sp.Name
	}
	t := deploy.Target{Kubeconfig: path, Kind: kind, Name: sp.Name, Namespace: sp.Namespace, Container: sp.Container, Image: sp.Image}

	fmt.Fprintf(w, "deploy:\n")
	fmt.Fprintf(w, "  目标: %s\n", targetName)
	fmt.Fprintf(w, "  workload: %s/%s\n", kind, sp.Name)
	fmt.Fprintf(w, "  命名空间: %s\n", sp.Namespace)
	fmt.Fprintf(w, "  容器: %s\n", sp.Container)
	fmt.Fprintf(w, "  镜像: %s\n", sp.Image)

	if err := deploy.SetImage(ctx, w, t); err != nil {
		return err
	}
	if replicas, _ := deploy.Replicas(ctx, w, t); replicas == 0 {
		fmt.Fprintf(w, "  副本数: 0 —— 无 rollout 可等待,镜像已更新(set image 成功即部署完成)\n")
		return nil
	}
	if err := deploy.RolloutStatus(ctx, w, t, formatTimeout(timeout)); err != nil {
		_ = deploy.RolloutUndo(ctx, w, t)
		return err
	}
	return nil
}

func formatTimeout(d time.Duration) string {
	if d%time.Minute == 0 {
		return fmt.Sprintf("%dm", int(d/time.Minute))
	}
	return d.String()
}

func writeTempKubeconfig(content string) (string, error) {
	f, err := os.CreateTemp("", "navori-kube-*.yaml")
	if err != nil {
		return "", err
	}
	if _, err := f.WriteString(content); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// CheckDeploy verifies kubectl connectivity with the supplied kubeconfig.
func CheckDeploy(ctx context.Context, kubeconfig, namespace string) error {
	return deploy.Check(ctx, kubeconfig, namespace)
}
