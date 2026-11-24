package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"navori/internal/agentx"
	"navori/internal/runner"
)

// runningJob tracks one step this agent is executing.
type runningJob struct {
	runID     uint
	startedAt time.Time
	cancel    context.CancelFunc
}

func (c *client) addRunning(stepID uint, job runningJob) {
	c.mu.Lock()
	c.running[stepID] = job
	c.mu.Unlock()
}

func (c *client) removeRunning(stepID uint) {
	c.mu.Lock()
	delete(c.running, stepID)
	c.mu.Unlock()
}

func (c *client) runningSteps() []agentx.RunningStep {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]agentx.RunningStep, 0, len(c.running))
	for id, j := range c.running {
		out = append(out, agentx.RunningStep{StepID: id, RunID: j.runID, StartedAt: j.startedAt})
	}
	return out
}

func (c *client) cancelRunning(stepID uint) {
	c.mu.Lock()
	j, ok := c.running[stepID]
	c.mu.Unlock()
	if !ok {
		log.Printf("cancel for unknown step %d", stepID)
		return
	}
	log.Printf("cancelling step %d", stepID)
	j.cancel()
}

// executeJob runs one claimed step and reports its terminal status.
func (c *client) executeJob(ctx context.Context, job agentx.Job) {
	if job.Kind == "deploy-check" {
		c.executeCheck(ctx, job)
		return
	}
	jobCtx, cancel := context.WithCancel(ctx)
	c.addRunning(job.JobID, runningJob{runID: job.RunID, startedAt: time.Now().UTC(), cancel: cancel})
	defer func() {
		cancel()
		c.removeRunning(job.JobID)
	}()

	logs := newLogSender(c, job.JobID, jobCtx)
	err := c.runJob(jobCtx, job, logs)
	logs.Close()

	status := "success"
	msg := ""
	if err != nil {
		switch {
		case ctx.Err() != nil:
			status = "failed"
			msg = "agent shutting down"
		case jobCtx.Err() != nil:
			status = "cancelled"
		default:
			status = "failed"
			msg = err.Error()
		}
	}
	if len(msg) > 4096 {
		msg = msg[:4096]
	}
	log.Printf("step %d (%s) %s %s", job.JobID, job.StepName, status, msg)

	rctx, rcancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer rcancel()
	c.reportResult(rctx, job.JobID, agentx.ResultReq{Status: status, Error: msg})
}

func (c *client) runJob(ctx context.Context, job agentx.Job, w io.Writer) error {
	switch job.StepName {
	case "pull":
		var p agentx.PullParams
		if err := job.DecodeParams(&p); err != nil {
			return err
		}
		return runner.Pull(ctx, w, runner.PullSpec{
			GitURL: p.GitURL,
			Branch: p.Branch,
			Dir:    c.resolveDir(p.Dir),
		})
	case "build":
		var p agentx.BuildParams
		if err := job.DecodeParams(&p); err != nil {
			return err
		}
		dockerfile := p.Dockerfile
		if dockerfile == "" {
			dockerfile = "Dockerfile"
		}
		return runner.Build(ctx, w, runner.BuildSpec{
			Dir:             c.resolveDir(p.Dir),
			Dockerfile:      dockerfile,
			Image:           job.ImageTag,
			Platform:        p.Platform,
			Args:            p.Args,
			DockerConfigDir: filepath.Join(c.cfg.Workdir, "docker-config"),
		})
	case "push":
		var p agentx.PushParams
		if err := job.DecodeParams(&p); err != nil {
			return err
		}
		image := p.Image
		if image == "" {
			image = job.ImageTag
		}
		return runner.Push(ctx, w, runner.PushSpec{
			Image:           image,
			RegistryURL:     p.RegistryURL,
			Username:        p.Username,
			Password:        p.Password,
			InsecureSkipTLS: p.InsecureSkipTLS,
		})
	case "deploy":
		var p agentx.DeployParams
		if err := job.DecodeParams(&p); err != nil {
			return err
		}
		kubeconfig, err := base64.StdEncoding.DecodeString(p.Kubeconfig)
		if err != nil {
			return fmt.Errorf("decode kubeconfig: %w", err)
		}
		timeout := time.Duration(p.TimeoutSeconds) * time.Second
		if timeout <= 0 {
			timeout = 5 * time.Minute
		}
		image := p.Image
		if image == "" {
			image = job.ImageTag
		}
		return runner.Deploy(ctx, w, runner.DeploySpec{
			Kubeconfig: string(kubeconfig),
			TargetName: p.Kind + "/" + p.Name,
			Kind:       p.Kind,
			Name:       p.Name,
			Namespace:  p.Namespace,
			Container:  p.Container,
			Image:      image,
			Timeout:    timeout,
		})
	default:
		return fmt.Errorf("unsupported step %q", job.StepName)
	}
}

func (c *client) resolveDir(dir string) string {
	if dir == "" {
		return c.cfg.Workdir
	}
	if filepath.IsAbs(dir) {
		return dir
	}
	return filepath.Join(c.cfg.Workdir, dir)
}

// logSender batches output lines and posts them to the server once a second
// or every 200 lines, whichever comes first.
type logSender struct {
	c       *client
	jobID   uint
	ctx     context.Context
	seq     int64
	mu      sync.Mutex
	partial string
	pending []string
	sendMu  sync.Mutex
	stop    chan struct{}
	done    chan struct{}
}

func newLogSender(c *client, jobID uint, ctx context.Context) *logSender {
	l := &logSender{c: c, jobID: jobID, ctx: ctx, stop: make(chan struct{}), done: make(chan struct{})}
	go func() {
		defer close(l.done)
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				l.flush()
			case <-l.stop:
				return
			}
		}
	}()
	return l
}

func (l *logSender) Write(p []byte) (int, error) {
	l.mu.Lock()
	l.partial += string(p)
	var batch []string
	for {
		if len(l.partial) > 8192 && !strings.Contains(l.partial, "\n") {
			line := l.partial[:8192]
			l.partial = l.partial[8192:]
			l.pending = append(l.pending, line)
			continue
		}
		i := strings.IndexByte(l.partial, '\n')
		if i < 0 {
			break
		}
		line := strings.TrimSuffix(l.partial[:i], "\r")
		l.partial = l.partial[i+1:]
		if len(line) > 8192 {
			line = line[:8192]
		}
		l.pending = append(l.pending, line)
	}
	if len(l.pending) >= 200 {
		batch = l.pending
		l.pending = nil
	}
	l.mu.Unlock()
	if len(batch) > 0 {
		l.send(batch)
	}
	return len(p), nil
}

func (l *logSender) flush() {
	l.mu.Lock()
	var batch []string
	if l.partial != "" {
		if len(l.partial) > 8192 {
			l.partial = l.partial[:8192]
		}
		l.pending = append(l.pending, l.partial)
		l.partial = ""
	}
	if len(l.pending) > 0 {
		batch = l.pending
		l.pending = nil
	}
	l.mu.Unlock()
	if len(batch) > 0 {
		l.send(batch)
	}
}

func (l *logSender) send(lines []string) {
	l.sendMu.Lock()
	defer l.sendMu.Unlock()
	l.seq++
	status, _, err := l.c.post(l.ctx, fmt.Sprintf("/api/agent/jobs/%d/log", l.jobID), agentx.LogChunk{
		Seq:   l.seq,
		Lines: lines,
	})
	if err != nil {
		if l.ctx.Err() == nil {
			log.Printf("upload log for step %d: %v", l.jobID, err)
		}
		return
	}
	if status != 200 && status != 204 {
		log.Printf("upload log for step %d: HTTP %d", l.jobID, status)
	}
}

// Close flushes buffered output and stops the batching goroutine.
func (l *logSender) Close() {
	close(l.stop)
	<-l.done
	l.flush()
}

// executeCheck runs a one-off kubectl check and reports it to the dedicated
// check endpoint. Checks are interactive: they never enter run history.
func (c *client) executeCheck(ctx context.Context, job agentx.Job) {
	var p agentx.DeployCheckParams
	if err := job.DecodeParams(&p); err != nil {
		c.reportCheck(ctx, job.JobID, false, err.Error())
		return
	}
	timeout := time.Duration(p.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	checkCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	err := runner.CheckDeploy(checkCtx, p.Kubeconfig, p.Namespace)
	ok := err == nil
	msg := ""
	if err != nil {
		msg = err.Error()
		if ctx.Err() != nil {
			msg = "agent shutting down"
		}
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
	}
	log.Printf("deploy-check %d: ok=%v %s", job.JobID, ok, msg)
	rctx, rcancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer rcancel()
	c.reportCheck(rctx, job.JobID, ok, msg)
}
