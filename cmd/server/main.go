package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"navori/internal/api"
	"navori/internal/auth"
	"navori/internal/config"
	"navori/internal/secrets"
	"navori/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	// master key for AES-256-GCM: explicit MASTER_KEY (env/config) wins;
	// otherwise auto-generate + persist under DATA_DIR.
	var sec *secrets.Secrets
	if cfg.MasterKey != "" {
		sec, err = secrets.NewFromHex(cfg.MasterKey)
		if err != nil {
			log.Fatalf("master key: %v", err)
		}
	} else {
		sec, err = secrets.LoadOrCreateMasterKey(cfg.DataDir)
		if err != nil {
			log.Fatalf("master key: %v", err)
		}
	}

	// JWT secret (auto-generate + persist if empty)
	jwtSecret, err := loadOrCreateJWTSecret(cfg)
	if err != nil {
		log.Fatalf("jwt secret: %v", err)
	}

	// database
	st, err := store.Open(cfg.DBDriver, cfg.DBDSN, cfg.DBPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	if err := st.Migrate(); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	// first-boot admin
	generated, err := auth.EnsureAdmin(st.DB, cfg.AdminUser, cfg.AdminPass)
	if err != nil {
		log.Fatalf("ensure admin: %v", err)
	}
	if generated != "" {
		log.Printf("===== first boot: created admin %q with generated password: %s =====", cfg.AdminUser, generated)
		log.Printf("(set ADMIN_PASSWORD env to avoid auto-generation; change it after login)")
	}

	authSvc := auth.New(jwtSecret, mustDuration(cfg.JWTExpiry))

	srv := &api.Server{DB: st, Auth: authSvc, Cfg: cfg, Sec: sec}
	srv.ReapInFlight()
	srv.StartHealthChecker(context.Background(), time.Duration(cfg.HealthCheckInterval)*time.Minute)
	srv.StartScheduler(context.Background())

	addr := ":" + cfg.Port
	log.Printf("navori listening on %s (db=%s)", addr, st.Driver)
	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func loadOrCreateJWTSecret(cfg *config.Config) (string, error) {
	if cfg.JWTSecret != "" {
		return cfg.JWTSecret, nil
	}
	path := filepath.Join(cfg.DataDir, "jwt.secret")
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		return string(b), nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	secret := hex.EncodeToString(key)
	if err := os.WriteFile(path, []byte(secret), 0o600); err != nil {
		return "", err
	}
	return secret, nil
}

func mustDuration(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 7 * 24 * time.Hour
	}
	return d
}
