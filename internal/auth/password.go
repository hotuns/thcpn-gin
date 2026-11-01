package auth

import (
	"strings"
	"unicode"

	"golang.org/x/crypto/bcrypt"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func ValidatePassword(password string, cfg config.PasswordConfig) error {
	maximum := min(cfg.MaxLength, 72) // bcrypt rejects passwords longer than 72 bytes.
	if len(password) < cfg.MinLength || len(password) > maximum {
		return apperr.PasswordLength(cfg.MinLength, maximum)
	}

	hasLetter := false
	hasDigit := false
	for _, r := range password {
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if unicode.IsDigit(r) {
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return apperr.New(apperr.KindInvalidArgument, "password must contain letters and digits")
	}

	return nil
}

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(passwordHash string, password string) bool {
	if strings.TrimSpace(passwordHash) == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)) == nil
}
