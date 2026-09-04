package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
)

// Config holds runtime configuration, loaded from (in precedence order):
// environment variables > config file > defaults.
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

// fileConfig mirrors Config for the optional JSON config file.
// JSON field names use snake_case to match env var names (lowercased).
type fileConfig struct {
	Port                string `json:"port"`
	DBDriver            string `json:"db_driver"`
	DBPath              string `json:"db_path"`
	DBDSN               string `json:"db_dsn"`
	DataDir             string `json:"data_dir"`
	MasterKey           string `json:"master_key"`
	JWTSecret           string `json:"jwt_secret"`
	JWTExpiry           string `json:"jwt_expires_in"`
	AdminUser           string `json:"admin_user"`
	AdminPass           string `json:"admin_password"`
	BaseURL             string `json:"base_url"`
	RunRetention        *int   `json:"run_retention"`
	HealthCheckInterval *int   `json:"health_check_interval"`
}

// configFilePath resolves the config file path:
// NAVORI_CONFIG env > ./navori.json > /etc/navori/navori.json
// Returns "" if none configured (env-only mode).
func configFilePath() string {
	if p := os.Getenv("NAVORI_CONFIG"); p != "" {
		return p
	}
	for _, cand := range []string{"navori.json", "/etc/navori/navori.json"} {
		if _, err := os.Stat(cand); err == nil {
			return cand
		}
	}
	return ""
}

// loadFile reads the config file if present. Missing file (when not
// explicitly requested) is fine; parse errors are surfaced.
func loadFile() (fileConfig, error) {
	var fc fileConfig
	path := configFilePath()
	if path == "" {
		return fc, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return fc, err
	}
	if err := json.Unmarshal(b, &fc); err != nil {
		return fc, err
	}
	return fc, nil
}

// Load builds Config: defaults <- file <- env (env wins when non-empty).
func Load() (*Config, error) {
	fc, err := loadFile()
	if err != nil {
		return nil, err
	}

	// resolve with helpers; each returns first non-empty of env, file, def.
	str := func(envKey, fileVal, def string) string {
		if v := os.Getenv(envKey); v != "" {
			return v
		}
		if fileVal != "" {
			return fileVal
		}
		return def
	}
	intv := func(envKey string, fileVal *int, def int) int {
		if v := os.Getenv(envKey); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				return n
			}
		}
		if fileVal != nil {
			return *fileVal
		}
		return def
	}

	c := &Config{
		Port:                str("PORT", fc.Port, "3000"),
		DBDriver:            str("DB_DRIVER", fc.DBDriver, "sqlite"),
		DBPath:              str("DB_PATH", fc.DBPath, ""), // resolved below after DataDir
		DBDSN:               str("DB_DSN", fc.DBDSN, ""),
		DataDir:             str("DATA_DIR", fc.DataDir, "data"),
		MasterKey:           str("MASTER_KEY", fc.MasterKey, ""),
		JWTSecret:           str("JWT_SECRET", fc.JWTSecret, ""),
		JWTExpiry:           str("JWT_EXPIRES_IN", fc.JWTExpiry, "168h"),
		AdminUser:           str("ADMIN_USER", fc.AdminUser, "admin"),
		AdminPass:           str("ADMIN_PASSWORD", fc.AdminPass, ""),
		BaseURL:             str("BASE_URL", fc.BaseURL, "http://localhost:3000"),
		Version:             "0.1.0",
		RunRetention:        intv("RUN_RETENTION", fc.RunRetention, 10),
		HealthCheckInterval: intv("HEALTH_CHECK_INTERVAL", fc.HealthCheckInterval, 5),
	}

	// DB_PATH default: <DATA_DIR>/navori.db (sqlite)
	if c.DBPath == "" {
		c.DBPath = filepath.Join(c.DataDir, "navori.db")
	}

	return c, nil
}
