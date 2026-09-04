package auth

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"navori/internal/store"
)

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := db.AutoMigrate(&store.User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func adminExists(db *gorm.DB) bool {
	var n int64
	db.Model(&store.User{}).Where("role = ?", "admin").Count(&n)
	return n > 0
}

func adminPasswordOK(db *gorm.DB, pw string) bool {
	var u store.User
	if err := db.Where("role = ?", "admin").First(&u).Error; err != nil {
		return false
	}
	return CheckPassword(u.PasswordHash, pw)
}

func TestEnsureAdminCreatesWithConfiguredPassword(t *testing.T) {
	db := openTestDB(t)
	gen, reset, err := EnsureAdmin(db, "admin", "secret-pass")
	if err != nil {
		t.Fatalf("EnsureAdmin: %v", err)
	}
	if gen != "" || reset {
		t.Errorf("gen=%q reset=%v, want empty/false", gen, reset)
	}
	if !adminExists(db) {
		t.Error("admin not created")
	}
	if !adminPasswordOK(db, "secret-pass") {
		t.Error("admin password does not match configured value")
	}
}

func TestEnsureAdminGeneratesOnFirstBoot(t *testing.T) {
	db := openTestDB(t)
	gen, reset, err := EnsureAdmin(db, "admin", "")
	if err != nil {
		t.Fatalf("EnsureAdmin: %v", err)
	}
	if len(gen) < 8 || reset {
		t.Errorf("gen=%q reset=%v, want generated password and no reset", gen, reset)
	}
	if !adminPasswordOK(db, gen) {
		t.Error("generated password should authenticate")
	}
}

func TestEnsureAdminResetsExistingToConfigured(t *testing.T) {
	db := openTestDB(t)
	if _, _, err := EnsureAdmin(db, "admin", "old-pass"); err != nil {
		t.Fatalf("EnsureAdmin(create): %v", err)
	}
	// existing admin + configured password -> reset
	gen, reset, err := EnsureAdmin(db, "admin", "new-pass")
	if err != nil {
		t.Fatalf("EnsureAdmin(reset): %v", err)
	}
	if gen != "" || !reset {
		t.Errorf("gen=%q reset=%v, want empty/true", gen, reset)
	}
	if !adminPasswordOK(db, "new-pass") {
		t.Error("admin password should now be new-pass")
	}
	if adminPasswordOK(db, "old-pass") {
		t.Error("old password should no longer work")
	}
}

func TestEnsureAdminLeavesExistingWhenNoPasswordConfigured(t *testing.T) {
	db := openTestDB(t)
	gen, _, err := EnsureAdmin(db, "admin", "")
	if err != nil {
		t.Fatalf("EnsureAdmin(create): %v", err)
	}
	// existing admin + empty configured password -> untouched
	gen2, reset, err := EnsureAdmin(db, "admin", "")
	if err != nil {
		t.Fatalf("EnsureAdmin(second): %v", err)
	}
	if gen2 != "" || reset {
		t.Errorf("gen=%q reset=%v, want empty/false (untouched)", gen2, reset)
	}
	if !adminPasswordOK(db, gen) {
		t.Error("original generated password should still work")
	}
}

func TestEnsureAdminWrongUsernameStillFindsAdminByRole(t *testing.T) {
	db := openTestDB(t)
	if _, _, err := EnsureAdmin(db, "root", "pw-a"); err != nil {
		t.Fatalf("EnsureAdmin: %v", err)
	}
	// username changed but role=admin lookup must still reset it
	gen, reset, err := EnsureAdmin(db, "admin", "pw-b")
	if err != nil {
		t.Fatalf("EnsureAdmin(second): %v", err)
	}
	if gen != "" || !reset {
		t.Errorf("gen=%q reset=%v, want empty/true", gen, reset)
	}
	if !adminPasswordOK(db, "pw-b") {
		t.Error("admin password should be pw-b")
	}
}
