package config

import (
	"os"
	"path/filepath"
	"strconv"
)

// Config holds runtime configuration, loaded from environment variables.
type Config struct {
	Port                string
	DBDriver            string // sqlite | mysql
	DBPath              string // sqlite file path
	DBDSN               string // mysql DSN
	DataDir             string // data directory (master key, jwt secret, workspaces, logs)
	JWTSecret           string // empty = auto-generate and persist
	JWTExpiry           string // e.g. "168h"
	AdminUser           string
	AdminPass           string // empty = auto-generate on first boot
	BaseURL             string // for webhook URL display
	Version             string
	RunRetention        int // keep last N runs per pipeline
	HealthCheckInterval int // minutes between registry/deploy health checks
}

func Load() *Config {
	dataDir := getenv("DATA_DIR", "data")
	dbPath := getenv("DB_PATH", "")
	if dbPath == "" {
		dbPath = filepath.Join(dataDir, "navori.db")
	}
	return &Config{
		Port:                getenv("PORT", "3000"),
		DBDriver:            getenv("DB_DRIVER", "sqlite"),
		DBPath:              dbPath,
		DBDSN:               getenv("DB_DSN", ""),
		DataDir:             dataDir,
		JWTSecret:           getenv("JWT_SECRET", ""),
		JWTExpiry:           getenv("JWT_EXPIRES_IN", "168h"),
		AdminUser:           getenv("ADMIN_USER", "admin"),
		AdminPass:           getenv("ADMIN_PASSWORD", ""),
		BaseURL:             getenv("BASE_URL", "http://localhost:3000"),
		Version:             "0.1.0",
		RunRetention:        getenvInt("RUN_RETENTION", 10),
		HealthCheckInterval: getenvInt("HEALTH_CHECK_INTERVAL", 5),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
