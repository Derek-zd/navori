// Command navori-agent is the remote executor for Navori. It only makes
// outbound HTTPS requests to the server, never serves a port, and never
// touches the server database or DATA_DIR.
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"navori/internal/agentx"
	"navori/internal/config"
)

const agentVersion = "0.1.0"

type agentConfig struct {
	URL          string
	Token        string
	Name         string
	Labels       string
	Workdir      string
	Concurrency  int
	InsecureSkip bool
	Hostname     string
}

type client struct {
	cfg       agentConfig
	http      *http.Client
	heartbeat time.Duration
	maxStep   time.Duration
	labels    map[string]string
	hostname  string

	mu      sync.Mutex
	running map[uint]runningJob
	wg      sync.WaitGroup
}

func main() {
	configFlag := flag.String("config", "", "path to agent config (.env style, KEY=VALUE); default ./navori-agent.env")
	flag.Parse()

	cfg, err := loadConfig(*configFlag)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	c := newClient(cfg)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := c.run(ctx); err != nil {
		log.Fatalf("agent stopped: %v", err)
	}
	log.Printf("agent %q stopped", cfg.Name)
}

func loadConfig(flagPath string) (agentConfig, error) {
	path := flagPath
	explicit := path != ""
	if path == "" {
		path = "navori-agent.env"
	}
	fileVals := map[string]string{}
	if _, err := os.Stat(path); err == nil {
		v, err := config.ParseEnvFile(path)
		if err != nil {
			return agentConfig{}, err
		}
		fileVals = v
	} else if !os.IsNotExist(err) {
		return agentConfig{}, err
	} else if explicit {
		return agentConfig{}, fmt.Errorf("config file %s not found", path)
	}

	get := func(key, def string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		if v := fileVals[key]; v != "" {
			return v
		}
		return def
	}

	cfg := agentConfig{
		URL:     strings.TrimRight(strings.TrimSpace(get("NAVORI_URL", "")), "/"),
		Token:   strings.TrimSpace(get("AGENT_TOKEN", "")),
		Name:    strings.TrimSpace(get("AGENT_NAME", "")),
		Labels:  get("AGENT_LABELS", ""),
		Workdir: get("AGENT_WORKDIR", "./navori-agent"),
	}
	if cfg.URL == "" {
		return cfg, fmt.Errorf("NAVORI_URL is required")
	}
	if !strings.HasPrefix(cfg.URL, "http://") && !strings.HasPrefix(cfg.URL, "https://") {
		return cfg, fmt.Errorf("NAVORI_URL must start with http:// or https://")
	}
	if cfg.Token == "" {
		return cfg, fmt.Errorf("AGENT_TOKEN is required")
	}
	if cfg.Name == "" {
		host, err := os.Hostname()
		if err != nil || host == "" {
			return cfg, fmt.Errorf("AGENT_NAME is required (hostname lookup failed)")
		}
		cfg.Name = host
	}
	cfg.Hostname, _ = os.Hostname()
	labels, err := agentx.NormalizeLabels(cfg.Labels)
	if err != nil {
		return cfg, fmt.Errorf("AGENT_LABELS: %w", err)
	}
	cfg.Labels = labels

	cfg.Concurrency = 1
	if v := get("AGENT_CONCURRENCY", ""); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return cfg, fmt.Errorf("AGENT_CONCURRENCY must be a positive integer")
		}
		cfg.Concurrency = n
	}
	if v := get("AGENT_INSECURE_SKIP_VERIFY", ""); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return cfg, fmt.Errorf("AGENT_INSECURE_SKIP_VERIFY must be true or false")
		}
		cfg.InsecureSkip = b
	}
	return cfg, nil
}

func newClient(cfg agentConfig) *client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.InsecureSkip {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // explicit opt-in for self-signed servers
	}
	labels, _ := agentx.ParseSelector(cfg.Labels)
	return &client{
		cfg:       cfg,
		http:      &http.Client{Timeout: 40 * time.Second, Transport: tr}, // > claim hold (25s)
		heartbeat: agentx.DefaultHeartbeatSeconds * time.Second,
		maxStep:   agentx.DefaultMaxStepSeconds * time.Second,
		labels:    labels,
		hostname:  cfg.Hostname,
		running:   make(map[uint]runningJob),
	}
}

func (c *client) run(ctx context.Context) error {
	if err := c.connect(ctx); err != nil {
		return err
	}
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	errCh := make(chan error, 2)
	go func() { errCh <- c.heartbeatLoop(runCtx) }()
	go func() { errCh <- c.claimLoop(runCtx) }()

	var err error
	select {
	case <-ctx.Done():
	case err = <-errCh:
		log.Printf("agent loop stopped: %v", err)
	}
	cancel()
	done := make(chan struct{})
	go func() { c.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		log.Printf("timed out waiting for running steps to stop")
	}
	return err
}

// connect performs hello with exponential backoff. Authentication and protocol
// errors are permanent; network errors and 5xx are retried.
func (c *client) connect(ctx context.Context) error {
	backoff := time.Second
	for {
		err := c.hello(ctx)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if permanent(err) {
			return err
		}
		log.Printf("hello failed: %v (retry in %s)", err, backoff)
		if !sleep(ctx, backoff) {
			return ctx.Err()
		}
		backoff *= 2
		if backoff > time.Minute {
			backoff = time.Minute
		}
	}
}

func (c *client) hello(ctx context.Context) error {
	status, data, err := c.post(ctx, "/api/agent/hello", agentx.HelloReq{
		Name:     c.cfg.Name,
		Version:  agentVersion,
		Labels:   c.labels,
		Host:     c.hostname,
		Protocol: agentx.Protocol,
	})
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return statusError(status, data)
	}
	var resp agentx.HelloResp
	if err := json.Unmarshal(data, &resp); err != nil {
		return fmt.Errorf("decode hello response: %w", err)
	}
	if resp.Protocol != agentx.Protocol {
		return fmt.Errorf("server protocol %d is not supported (agent protocol %d)", resp.Protocol, agentx.Protocol)
	}
	if resp.HeartbeatSeconds > 0 {
		c.heartbeat = time.Duration(resp.HeartbeatSeconds) * time.Second
	}
	if resp.MaxStepSeconds > 0 {
		c.maxStep = time.Duration(resp.MaxStepSeconds) * time.Second
	}
	log.Printf("connected to %s as %q (server %s, heartbeat %s, claimWait %ds)",
		c.cfg.URL, c.cfg.Name, resp.ServerVersion, c.heartbeat, resp.ClaimWaitSeconds)
	return nil
}

func (c *client) heartbeatLoop(ctx context.Context) error {
	t := time.NewTicker(c.heartbeat)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			status, data, err := c.post(ctx, "/api/agent/heartbeat", agentx.HeartbeatReq{
				Version: agentVersion,
				Running: c.runningSteps(),
			})
			if err != nil {
				if ctx.Err() != nil {
					return nil
				}
				log.Printf("heartbeat failed: %v", err)
				continue
			}
			if status != http.StatusOK {
				err := statusError(status, data)
				if permanent(err) {
					return err
				}
				log.Printf("heartbeat rejected: %v", err)
				continue
			}
			var resp agentx.HeartbeatResp
			if err := json.Unmarshal(data, &resp); err != nil {
				log.Printf("decode heartbeat response: %v", err)
				continue
			}
			for _, id := range resp.Cancel {
				c.cancelRunning(id)
			}
		}
	}
}

// claimLoop keeps up to AGENT_CONCURRENCY jobs in flight and long-polls for
// more work. The server holds a claim for up to 25s and answers 204 on timeout.
func (c *client) claimLoop(ctx context.Context) error {
	backoff := time.Second
	sem := make(chan struct{}, c.cfg.Concurrency)
	for {
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			return nil
		}
		status, data, err := c.post(ctx, "/api/agent/jobs/claim", struct{}{})
		if err != nil {
			<-sem
			if ctx.Err() != nil {
				return nil
			}
			log.Printf("claim failed: %v (retry in %s)", err, backoff)
			if !sleep(ctx, backoff) {
				return nil
			}
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
			continue
		}
		backoff = time.Second
		switch status {
		case http.StatusNoContent:
			<-sem
			if !sleep(ctx, 500*time.Millisecond) {
				return nil
			}
		case http.StatusOK:
			var job agentx.Job
			if err := json.Unmarshal(data, &job); err != nil {
				<-sem
				log.Printf("decode job: %v", err)
				continue
			}
			log.Printf("received job %d (%s) run %d", job.JobID, job.StepName, job.RunID)
			c.wg.Add(1)
			go func() {
				defer c.wg.Done()
				defer func() { <-sem }()
				c.executeJob(ctx, job)
			}()
		default:
			<-sem
			err := statusError(status, data)
			if permanent(err) {
				return err
			}
			log.Printf("claim rejected: %v", err)
			if !sleep(ctx, backoff) {
				return nil
			}
		}
	}
}

func (c *client) reportResult(ctx context.Context, jobID uint, res agentx.ResultReq) {
	status, _, err := c.post(ctx, fmt.Sprintf("/api/agent/jobs/%d/result", jobID), res)
	if err != nil {
		log.Printf("report result for step %d: %v", jobID, err)
		return
	}
	if status != http.StatusOK && status != http.StatusNoContent {
		log.Printf("report result for step %d: HTTP %d", jobID, status)
	}
}

func (c *client) post(ctx context.Context, path string, payload any) (int, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.URL+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, data, nil
}

type apiError struct {
	Status  int
	Code    string
	Message string
}

func (e *apiError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("HTTP %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("%s (HTTP %d): %s", e.Code, e.Status, e.Message)
}

func statusError(status int, data []byte) error {
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(data, &body)
	msg := body.Error.Message
	if msg == "" {
		msg = strings.TrimSpace(string(data))
	}
	return &apiError{Status: status, Code: body.Error.Code, Message: msg}
}

// permanent reports whether an error should stop the agent instead of being
// retried (bad token, disabled agent, protocol mismatch, name mismatch).
func permanent(err error) bool {
	ae, ok := err.(*apiError)
	if !ok {
		return false
	}
	return ae.Status >= 400 && ae.Status < 500 && ae.Status != http.StatusRequestTimeout && ae.Status != http.StatusTooManyRequests
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
