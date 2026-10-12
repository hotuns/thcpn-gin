package device

import (
	"strings"
	"thcpn-gin/internal/apperr"
)

func normalizeICCID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if len(value) != 19 && len(value) != 20 {
		return "", apperr.New(apperr.KindInvalidArgument, "ICCID must contain 19 or 20 digits")
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return "", apperr.New(apperr.KindInvalidArgument, "ICCID must contain 19 or 20 digits")
		}
	}
	return value, nil
}
