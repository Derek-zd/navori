package config

import (
	"os"
	"path/filepath"
	"testing"
)

// clearEnv removes all keys Load() may read, so tests are hermetic.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"PORT", "DB_DRIVER", "DB_PATH", "DB_DSN", "DATA_DIR",
		"MASTER_KEY", "JWT_SECRET", "JWT_EXPIRES_IN",
		"ADMIN_USER", "ADMIN_PASSWORD", "BASE_URL",
		"RUN_RETENTION", "HEALTH_CHECK_INTERVAL",
	} {
		t.Setenv(k, "")
	}
}

func writeEnvFile(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "navori.env")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadDefaultsEnvOnly(t *testing.T) {
	clearEnv(t)
	c, err := Load("")
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

func TestLoadFromConfigFile(t *testing.T) {
	clearEnv(t)
	p := writeEnvFile(t, `# navori config
PORT=8080
DB_DRIVER=mysql
DB_DSN=user:pass@tcp(db:3306)/navori?charset=utf8mb4&parseTime=True&loc=Local
DATA_DIR=/opt/navori
MASTER_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
JWT_SECRET=file-jwt
RUN_RETENTION=25
HEALTH_CHECK_INTERVAL=7
export ADMIN_USER=fileadmin
`)

	c, err := Load(p)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Port != "8080" {
		t.Errorf("Port = %q, want 8080", c.Port)
	}
	if c.DBDriver != "mysql" || c.DBDSN == "" {
		t.Errorf("DB config wrong: driver=%q dsn=%q", c.DBDriver, c.DBDSN)
	}
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
	if c.AdminUser != "fileadmin" {
		t.Errorf("AdminUser = %q, want fileadmin (export prefix)", c.AdminUser)
	}
}

func TestEnvOverridesFile(t *testing.T) {
	clearEnv(t)
	p := writeEnvFile(t, "PORT=8080\nDB_DRIVER=sqlite\nADMIN_USER=fileuser\n")

	t.Setenv("PORT", "9090") // env wins over file
	t.Setenv("DB_DRIVER", "mysql")
	t.Setenv("DB_DSN", "env-dsn") // env-only (not in file)
	t.Setenv("ADMIN_USER", "")    // empty env: keep file value
	t.Setenv("DATA_DIR", "/envdata")

	c, err := Load(p)
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

func TestExplicitMissingConfigFileErrors(t *testing.T) {
	clearEnv(t)
	_, err := Load(filepath.Join(t.TempDir(), "does-not-exist.env"))
	if err == nil {
		t.Fatal("expected error when explicit -config file is missing")
	}
}

func TestAutoProbeConfigFile(t *testing.T) {
	clearEnv(t)
	dir := t.TempDir()
	p := filepath.Join(dir, "navori.env")
	if err := os.WriteFile(p, []byte("PORT=7777\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	oldWd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(oldWd) }()

	c, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Port != "7777" {
		t.Errorf("Port = %q, want 7777 from ./navori.env probe", c.Port)
	}
}

func TestParseEnvFileQuotesAndComments(t *testing.T) {
	clearEnv(t)
	p := writeEnvFile(t, `
# leading comment
ADMIN_PASSWORD="p@ss with spaces"
BASE_URL='https://navori.example.com'

unquoted=value
`)
	c, err := Load(p)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.AdminPass != "p@ss with spaces" {
		t.Errorf("AdminPass = %q", c.AdminPass)
	}
	if c.BaseURL != "https://navori.example.com" {
		t.Errorf("BaseURL = %q", c.BaseURL)
	}
}

func TestParseEnvFileInlineComments(t *testing.T) {
	clearEnv(t)
	p := writeEnvFile(t, `ADMIN_PASSWORD=navori@2026      # 留空首启自动生成（打印到日志）
JWT_SECRET=abc # inline comment
PORT=3000 # trailing space comment
MASTER_KEY=quoted#hash # this comment is stripped
`)
	c, err := Load(p)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.AdminPass != "navori@2026" {
		t.Errorf("AdminPass = %q, want navori@2026 (inline comment must be stripped)", c.AdminPass)
	}
	if c.JWTSecret != "abc" {
		t.Errorf("JWTSecret = %q, want abc", c.JWTSecret)
	}
	if c.Port != "3000" {
		t.Errorf("Port = %q, want 3000 (inline comment after space stripped)", c.Port)
	}
	if c.MasterKey != "quoted#hash" {
		t.Errorf("MasterKey = %q, want quoted#hash (quoted value keeps #)", c.MasterKey)
	}
}
