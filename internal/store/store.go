package store

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// Store wraps the database handle.
type Store struct {
	DB     *gorm.DB
	Driver string
}

// Open connects to SQLite or MySQL based on driver.
func Open(driver, dsn, path string) (*Store, error) {
	var dialector gorm.Dialector
	switch driver {
	case "sqlite":
		if dir := filepath.Dir(path); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create sqlite dir: %w", err)
			}
		}
		dialector = sqlite.Open(path)
	case "mysql":
		if dsn == "" {
			return nil, fmt.Errorf("DB_DSN is required when DB_DRIVER=mysql")
		}
		dialector = mysql.Open(dsn)
	default:
		return nil, fmt.Errorf("unsupported DB_DRIVER %q (want sqlite or mysql)", driver)
	}

	db, err := gorm.Open(dialector, &gorm.Config{})
	if err != nil {
		if driver == "mysql" && strings.Contains(err.Error(), "default addr for network") {
			// DSN host written without tcp(...) wrapper, e.g.
			//   user:pass@host:3306/db   (wrong)
			//   user:pass@tcp(host:3306)/db  (right)
			return nil, fmt.Errorf("open mysql: %w (hint: DB_DSN host must be wrapped as tcp(host:port), e.g. user:pass@tcp(dbhost:3306)/navori?charset=utf8mb4&parseTime=True&loc=Local)", err)
		}
		return nil, fmt.Errorf("open %s: %w", driver, err)
	}
	return &Store{DB: db, Driver: driver}, nil
}

// Migrate creates/updates all tables.
func (s *Store) Migrate() error {
	return s.DB.AutoMigrate(
		&User{}, &Registry{}, &DeployTarget{}, &GitCredential{},
		&Repository{}, &Pipeline{}, &Run{}, &Step{}, &Variable{},
		&WebhookEvent{}, &AuditLog{}, &NotifyChannel{}, &AppConfig{},
	)
}
