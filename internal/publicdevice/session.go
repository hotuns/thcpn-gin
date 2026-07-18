package publicdevice

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const sessionTTL = 7 * 24 * time.Hour

type sessionManager struct{ secret []byte }

type sessionClaims struct {
	jwt.RegisteredClaims
	Slug    string `json:"slug"`
	Version int    `json:"ver"`
}

func newSessionManager(secret string) *sessionManager { return &sessionManager{secret: []byte(secret)} }

func (m *sessionManager) create(publication Publication) (string, time.Time, error) {
	now := time.Now()
	expiresAt := now.Add(sessionTTL)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, sessionClaims{
		RegisteredClaims: jwt.RegisteredClaims{IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expiresAt)},
		Slug:             publication.PublicSlug, Version: publication.AccessVersion,
	})
	value, err := token.SignedString(m.secret)
	return value, expiresAt, err
}

func (m *sessionManager) valid(value string, publication Publication) bool {
	if value == "" {
		return false
	}
	parsed, err := jwt.ParseWithClaims(value, &sessionClaims{}, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected jwt signing method")
		}
		return m.secret, nil
	})
	if err != nil || !parsed.Valid {
		return false
	}
	claims, ok := parsed.Claims.(*sessionClaims)
	return ok && claims.Slug == publication.PublicSlug && claims.Version == publication.AccessVersion
}
