package buildx

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Build builds an image from dockerfile in dir, tagging it as tag.
func Build(ctx context.Context, w io.Writer, dir, dockerfile, tag, platform string, args map[string]string, dockerConfig string) error {
	cmdArgs := []string{"build", "-t", tag, "-f", dockerfile}
	if platform != "" {
		cmdArgs = append(cmdArgs, "--platform", platform)
	}
	for k, v := range args {
		cmdArgs = append(cmdArgs, "--build-arg", k+"="+v)
	}
	cmdArgs = append(cmdArgs, ".")
	cmd := exec.CommandContext(ctx, "docker", cmdArgs...)
	cmd.Dir = dir
	if dockerConfig != "" {
		cmd.Env = append(os.Environ(), "DOCKER_CONFIG="+dockerConfig)
	}
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}

// Push pushes an image tag to its registry. If dockerConfig is non-empty it is
// used as DOCKER_CONFIG so the push can use credentials stored in a temporary
// directory instead of the user's global docker credentials.
func Push(ctx context.Context, w io.Writer, tag, dockerConfig string) error {
	cmd := exec.CommandContext(ctx, "docker", "push", tag)
	if dockerConfig != "" {
		cmd.Env = append(os.Environ(), "DOCKER_CONFIG="+dockerConfig)
	}
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}

// Login runs docker login and stores credentials only in a temporary
// DOCKER_CONFIG directory, avoiding writes to the system credential store.
// It returns the temporary config directory; caller should remove it after use.
func LoginTo(ctx context.Context, w io.Writer, url, username, password string) (string, error) {
	dir, err := os.MkdirTemp("", "navori-docker-*")
	if err != nil {
		return "", err
	}
	// Write an empty docker config to avoid inheriting the global credential store.
	empty := []byte("{\"auths\":{}}")
	if err := os.WriteFile(filepath.Join(dir, "config.json"), empty, 0o600); err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	cmd := exec.CommandContext(ctx, "docker", "login", url, "-u", username, "--password-stdin")
	cmd.Env = append(os.Environ(), "DOCKER_CONFIG="+dir)
	cmd.Stdin = strings.NewReader(password)
	cmd.Stdout = w
	cmd.Stderr = w
	if err := cmd.Run(); err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	return dir, nil
}

// WriteAuthConfig creates a temporary docker config.json containing registry
// auth entries. It never invokes docker login or the OS credential helper.
func WriteAuthConfig(rawURL, username, password string) (string, error) {
	host := registryHost(rawURL)
	dir, err := os.MkdirTemp("", "navori-docker-*")
	if err != nil {
		return "", err
	}
	auth := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
	cfg := map[string]interface{}{
		"auths": map[string]interface{}{
			host: map[string]interface{}{"auth": auth},
		},
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), b, 0o600); err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	return dir, nil
}

func registryHost(rawURL string) string {
	u := strings.TrimSpace(rawURL)
	if !strings.Contains(u, "://") {
		u = "https://" + u
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return u
	}
	return parsed.Host
}

// Login validates registry credentials. Credentials are stored in a temporary
// DOCKER_CONFIG directory and removed when the call returns.
func Login(ctx context.Context, w io.Writer, url, username, password string) error {
	dir, err := LoginTo(ctx, w, url, username, password)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}
