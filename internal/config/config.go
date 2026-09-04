package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds runtime configuration, loaded from (in precedence order):
// environment variables > -config file (.env style) > defaults.
type Config struct {
	Port                string
	DBDriver            string // sqlite | mysql
	DBPath              string // sqlite file path
	DBDSN               string // mysql DSN
	DataDir             string // data directory (master key, jwt secret, workspaces, logs)
	MasterKey           string // hex 32-byte AES key (overrides data/master.key)
	JWTSecret           string // empty = auto-generate and persist
	JWTExpiry           string // e.g. "168h"
	AdminUser           string
	AdminPass           string // empty = auto-generate on first boot
	BaseURL             string // for webhook URL display
	Version             string
	RunRetention        int // keep last N runs per pipeline
	HealthCheckInterval int // minutes between registry/deploy health checks
}

// defaultFileCandidates are probed (in order) when no -config flag is given.
// The first existing file wins; if none exists, env-only mode is used.
var defaultFileCandidates = []string{"navori.env", "/etc/navori/navori.env"}

// Load builds Config. flagPath is the -config flag value ("" if not given).
//
// Source precedence (high -> low):
//  1. environment variables (non-empty wins)
//  2. config file: flagPath if given, else first existing defaultFileCandidates
//  3. built-in defaults
//
// Config file format is plain KEY=VALUE lines (# comments and blank lines
// ignored), i.e. the same keys as the environment.
func Load(flagPath string) (*Config, error) {
	path := flagPath
	if path == "" {
		for _, c := range defaultFileCandidates {
			if _, err := os.Stat(c); err == nil {
				path = c
				break
			}
		}
	}

	fileVals := map[string]string{}
	if path != "" {
		fv, err := parseEnvFile(path)
		if err != nil {
			return nil, err
		}
		fileVals = fv
	}

	// get returns env value if non-empty, else file value if non-empty, else def.
	get := func(envKey, def string) string {
		if v := os.Getenv(envKey); v != "" {
			return v
		}
		if v := fileVals[envKey]; v != "" {
			return v
		}
		return def
	}
	getInt := func(envKey string, def int) int {
		if v := get(envKey, ""); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				return n
			}
		}
		return def
	}

	dataDir := get("DATA_DIR", "data")
	c := &Config{
		Port:                get("PORT", "3000"),
		DBDriver:            get("DB_DRIVER", "sqlite"),
		DBPath:              get("DB_PATH", filepath.Join(dataDir, "navori.db")),
		DBDSN:               get("DB_DSN", ""),
		DataDir:             dataDir,
		MasterKey:           get("MASTER_KEY", ""),
		JWTSecret:           get("JWT_SECRET", ""),
		JWTExpiry:           get("JWT_EXPIRES_IN", "168h"),
		AdminUser:           get("ADMIN_USER", "admin"),
		AdminPass:           get("ADMIN_PASSWORD", ""),
		BaseURL:             get("BASE_URL", "http://localhost:3000"),
		Version:             "0.1.0",
		RunRetention:        getInt("RUN_RETENTION", 10),
		HealthCheckInterval: getInt("HEALTH_CHECK_INTERVAL", 5),
	}
	return c, nil
}

// parseEnvFile reads a KEY=VALUE file (".env" style). Lines starting with '#'
// and blank lines are ignored. Keys may optionally be prefixed with "export".
// Values may be optionally wrapped in single/double quotes. An inline comment
// (a " #" outside quotes) is stripped; to keep a literal "#" in a value, wrap
// the value in quotes.
func parseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open config file %s: %w", path, err)
	}
	defer f.Close()

	out := map[string]string{}
	sc := bufio.NewScanner(f)
	ln := 0
	for sc.Scan() {
		ln++
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		idx := strings.Index(line, "=")
		if idx <= 0 {
			return nil, fmt.Errorf("parse config file %s: line %d: expected KEY=VALUE", path, ln)
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		// strip inline comment: " #" outside quotes
		if !strings.HasPrefix(val, "\"") && !strings.HasPrefix(val, "'") {
			if ci := strings.Index(val, " #"); ci >= 0 {
				val = strings.TrimSpace(val[:ci])
			}
		}
		if len(val) >= 2 {
			if (val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'') {
				val = val[1 : len(val)-1]
			}
		}
		out[key] = val
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("read config file %s: %w", path, err)
	}
	return out, nil
}
