package gitx

import (
	"fmt"
	"io"
	"io/fs"
	"os/exec"
	"path/filepath"
	"strings"
)

// Clone clones url into dir (shallow, single branch).
// Credentials are expected to be embedded in url by the caller (https token) or
// provided via the environment (ssh key through GIT_SSH_COMMAND).
func Clone(dir, url, branch string) error {
	args := []string{"clone", "--depth", "1"}
	if branch != "" {
		args = append(args, "--branch", branch)
	}
	args = append(args, url, dir)
	if err := run("", args...); err != nil {
		return err
	}
	return nil
}

// Pull fast-forwards the repository at dir.
func Pull(dir string) error {
	return run(dir, "pull", "--ff-only")
}

// Checkout switches to branch, creating a local branch tracking origin if needed.
func Checkout(dir, branch string) error {
	if branch == "" {
		return nil
	}
	if err := run(dir, "checkout", branch); err == nil {
		return nil
	}
	return run(dir, "checkout", "-b", branch, "origin/"+branch)
}

// CloneW clones with command output written to w.
func CloneW(dir, url, branch string, w io.Writer) error {
	args := []string{"clone", "--depth", "1"}
	if branch != "" {
		args = append(args, "--branch", branch)
	}
	args = append(args, url, dir)
	return runW("", w, args...)
}

// PullW fast-forwards with command output written to w.
func PullW(dir string, w io.Writer) error {
	return runW(dir, w, "pull", "--ff-only")
}

// CheckoutW switches branch with command output written to w.
func CheckoutW(dir, branch string, w io.Writer) error {
	if branch == "" {
		return nil
	}
	if err := runW(dir, w, "checkout", branch); err == nil {
		return nil
	}
	return runW(dir, w, "checkout", "-b", branch, "origin/"+branch)
}

func runW(dir string, w io.Writer, args ...string) error {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Stdout = w
	cmd.Stderr = w
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return nil
}

// RemoteHead returns the remote HEAD commit sha via git ls-remote.
func RemoteHead(url string) (string, error) {
	cmd := exec.Command("git", "ls-remote", url, "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git ls-remote: %w", err)
	}
	fields := strings.Fields(strings.TrimSpace(string(out)))
	if len(fields) == 0 {
		return "", fmt.Errorf("git ls-remote: no HEAD")
	}
	return fields[0], nil
}

// HeadCommit returns the current HEAD commit sha.
func HeadCommit(dir string) (string, error) {
	out, err := output(dir, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// DefaultBranch returns the default branch name (e.g. "main") from origin HEAD.
func DefaultBranch(dir string) (string, error) {
	out, err := output(dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimPrefix(strings.TrimSpace(out), "origin/"), nil
}

// RemoteDefaultBranch returns the remote's default branch name (the branch its
// HEAD points at) using ls-remote --symref, without needing a local clone.
func RemoteDefaultBranch(url string) (string, error) {
	cmd := exec.Command("git", "ls-remote", "--symref", url, "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git ls-remote --symref: %w", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "ref:") {
			// e.g. "ref: refs/heads/main\tHEAD"
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				return strings.TrimPrefix(fields[1], "refs/heads/"), nil
			}
		}
	}
	return "", fmt.Errorf("git ls-remote --symref: no HEAD symref")
}

// FindDockerfile returns the relative path of a Dockerfile within 3 directory levels.
func FindDockerfile(root string) (string, error) {
	var found string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		if d.IsDir() {
			if d.Name() == ".git" || strings.Count(rel, string(filepath.Separator)) >= 3 {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() == "Dockerfile" && found == "" {
			found = rel
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if found == "" {
		return "", fmt.Errorf("no Dockerfile found within 3 levels")
	}
	return found, nil
}

func run(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func output(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return string(out), nil
}
