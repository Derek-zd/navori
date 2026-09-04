package auth

import (
	"crypto/rand"
	"encoding/hex"

	"gorm.io/gorm"

	"navori/internal/store"
)

// EnsureAdmin creates the built-in admin on first boot.
// Returns the generated password (only when one was auto-generated).
func EnsureAdmin(db *gorm.DB, username, password string) (string, error) {
	var count int64
	if err := db.Model(&store.User{}).Where("role = ?", "admin").Count(&count).Error; err != nil {
		return "", err
	}
	if count > 0 {
		return "", nil
	}

	generated := ""
	if password == "" {
		p, err := randomHex(16)
		if err != nil {
			return "", err
		}
		password = p
		generated = p
	}

	hash, err := HashPassword(password)
	if err != nil {
		return "", err
	}

	u := store.User{Username: username, PasswordHash: hash, Role: "admin"}
	if err := db.Create(&u).Error; err != nil {
		return "", err
	}
	return generated, nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
