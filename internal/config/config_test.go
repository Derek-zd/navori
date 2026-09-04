package config

import (
	"os"
	"path/filepath"
	"testing"
)

// writeFile writes a temp config file and returns its path.
func writeCfg(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "navori.json")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// clearEnv removes all keys Load() may read, so tests are hermetic.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"PORT", "DB_DRIVER", "DB_PATH", "DB_DSN", "DATA_DIR",
		"MASTER_KEY", "JWT_SECRET", "JWT_EXPIRES_IN",
		"ADMIN_USER", "ADMIN_PASSWORD", "BASE_URL",
		"RUN_RETENTION", "HEALTH_CHECK_INTERVAL", "NAVORI_CONFIG",
	} {
		t.Setenv(k, "")
	}
}

func TestLoadDefaults(t *testing.T) {
	clearEnv(t)
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Port != "3000" {
		t.Errorf("Port = %q, want 3000", c.Port)
	}
	if c.DBDriver != "sqlite" {
		t.Errorf("DBDriver = %q, want sqlite", c.DBDriver)
	}
	want := filepath.Join("data", "navori.db")
	if c.DBPath != want {
		t.Errorf("DBPath = %q, want %q", c.DBPath, want)
	}
	if c.RunRetention != 10 || c.HealthCheckInterval != 5 {
		t.Errorf("int defaults wrong: retention=%d health=%d", c.RunRetention, c.HealthCheckInterval)
	}
	if c.MasterKey != "" || c.JWTSecret != "" {
		t.Errorf("master/jwt should default empty: %q %q", c.MasterKey, c.JWTSecret)
	}
}

func TestLoadFromFile(t *testing.T) {
	clearEnv(t)
	p := writeCfg(t, `{
  "port": "8080",
  "db_driver": "mysql",
  "db_dsn": "user:pass@tcp(db:3306)/navori?charset=utf8mb4&parseTime=True&loc=Local",
  "data_dir": "/opt/navori",
  "master_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "jwt_secret": "file-jwt",
  "run_retention": 25,
  "health_check_interval": 7
}`)
	t.Setenv("NAVORI_CONFIG", p)

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Port != "8080" {
		t.Errorf("Port = %q, want 8080", c.Port)
	}
	if c.DBDriver != "mysql" || c.DBDSN == "" {
		t.Errorf("DB config from file wrong: driver=%q dsn=%q", c.DBDriver, c.DBDSN)
	}
	// DB_PATH empty in file -> default under data_dir
	want := filepath.Join("/opt/navori", "navori.db")
	if c.DBPath != want {
		t.Errorf("DBPath = %q, want %q", c.DBPath, want)
	}
	if c.MasterKey != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Errorf("MasterKey not read from file")
	}
	if c.JWTSecret != "file-jwt" {
		t.Errorf("JWTSecret not read from file")
	}
	if c.RunRetention != 25 || c.HealthCheckInterval != 7 {
		t.Errorf("file ints wrong: %d %d", c.RunRetention, c.HealthCheckInterval)
	}
}

func TestEnvOverridesFile(t *testing.T) {
	clearEnv(t)
	p := writeCfg(t, `{"port": "8080", "db_driver": "sqlite", "admin_user": "fileuser"}`)
	t.Setenv("NAVORI_CONFIG", p)

	t.Setenv("PORT", "9090")         // env wins over file
	t.Setenv("DB_DRIVER", "mysql")   // env wins
	t.Setenv("DB_DSN", "env-dsn")    // env-only (not in file)
	t.Setenv("ADMIN_USER", "")       // empty env: keep file value
	t.Setenv("DATA_DIR", "/envdata") // env-only default applies

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Port != "9090" {
		t.Errorf("Port = %q, want 9090 (env should override file)", c.Port)
	}
	if c.DBDriver != "mysql" {
		t.Errorf("DBDriver = %q, want mysql", c.DBDriver)
	}
	if c.DBDSN != "env-dsn" {
		t.Errorf("DBDSN = %q, want env-dsn", c.DBDSN)
	}
	if c.AdminUser != "fileuser" {
		t.Errorf("AdminUser = %q, want fileuser (empty env keeps file)", c.AdminUser)
	}
	want := filepath.Join("/envdata", "navori.db")
	if c.DBPath != want {
		t.Errorf("DBPath = %q, want %q", c.DBPath, want)
	}
}

func TestMissingConfigFileIsFine(t *testing.T) {
	clearEnv(t)
	t.Setenv("NAVORI_CONFIG", filepath.Join(t.TempDir(), "does-not-exist.json"))
	c, err := Load()
	if err == nil {
		// explicit NAVORI_CONFIG pointing to a missing file should error
		// so misconfiguration is caught early.
		t.Fatalf("expected error for missing NAVORI_CONFIG file, got config %+v", c)
	}
}
