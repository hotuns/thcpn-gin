package auth

import (
	"strings"
	"unicode"

	"thcpn-gin/internal/apperr"
)

func NormalizePhone(phone string) (string, error) {
	trimmed := strings.TrimSpace(phone)
	if trimmed == "" {
		return "", apperr.New(apperr.KindInvalidArgument, "phone is required")
	}

	var b strings.Builder
	for i, r := range trimmed {
		switch {
		case unicode.IsDigit(r):
			b.WriteRune(r)
		case r == '+' && i == 0:
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '\t':
			continue
		default:
			return "", apperr.New(apperr.KindInvalidArgument, "invalid phone")
		}
	}

	normalized := b.String()
	digits := strings.TrimPrefix(normalized, "+")
	if len(digits) < 6 || len(digits) > 20 {
		return "", apperr.New(apperr.KindInvalidArgument, "invalid phone")
	}
	return normalized, nil
}
