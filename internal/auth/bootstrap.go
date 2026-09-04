package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"

	"gorm.io/gorm"

	"navori/internal/store"
)

// EnsureAdmin makes sure the built-in admin user exists and matches the
// configured ADMIN_PASSWORD. Semantics:
//
//   - password != "": authoritative — create the admin if missing, otherwise
//     reset the existing admin's password to it on every start. (If you change
//     the admin password in the UI, update or clear ADMIN_PASSWORD in the
//     config, or the next restart will reset it back.)
//   - password == "": only bootstrap — create the admin with a random password
//     on first boot; an already-existing admin is left untouched.
//
// Returns the auto-generated password ("" when none was generated) and whether
// an existing admin's password was reset to the configured value.
func EnsureAdmin(db *gorm.DB, username, password string) (generated string, reset bool, err error) {
	var admin store.User
	err = db.Where("role = ?", "admin").First(&admin).Error
	exists := err == nil
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, err
	}

	if !exists {
		if password == "" {
			p, err := randomHex(16)
			if err != nil {
				return "", false, err
			}
			password = p
			generated = p
		}
		hash, err := HashPassword(password)
		if err != nil {
			return "", false, err
		}
		u := store.User{Username: username, PasswordHash: hash, Role: "admin"}
		if err := db.Create(&u).Error; err != nil {
			return "", false, err
		}
		return generated, false, nil
	}

	// admin already exists
	if password == "" {
		return "", false, nil // leave untouched
	}
	hash, err := HashPassword(password)
	if err != nil {
		return "", false, err
	}
	if err := db.Model(&admin).Update("password_hash", hash).Error; err != nil {
		return "", false, err
	}
	return "", true, nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
