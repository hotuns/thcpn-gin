package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type TokenManager struct {
	secret []byte
	ttl    time.Duration
}

type TokenPair struct {
	AccessToken string    `json:"access_token"`
	TokenType   string    `json:"token_type"`
	ExpiresIn   int64     `json:"expires_in"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type AccessTokenInfo struct {
	UserID      uuid.UUID
	AuthVersion int
	ExpiresAt   time.Time
}

type accessClaims struct {
	jwt.RegisteredClaims
	AuthVersion int `json:"ver,omitempty"`
}

func NewTokenManager(secret string, ttl time.Duration) *TokenManager {
	return &TokenManager{
		secret: []byte(secret),
		ttl:    ttl,
	}
}

func (m *TokenManager) Generate(userID uuid.UUID) (TokenPair, error) {
	return m.GenerateWithVersion(userID, 0)
}

func (m *TokenManager) GenerateWithVersion(userID uuid.UUID, authVersion int) (TokenPair, error) {
	now := time.Now()
	expiresAt := now.Add(m.ttl)

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
		AuthVersion: authVersion,
	})

	signed, err := token.SignedString(m.secret)
	if err != nil {
		return TokenPair{}, err
	}

	return TokenPair{
		AccessToken: signed,
		TokenType:   "Bearer",
		ExpiresIn:   int64(m.ttl.Seconds()),
		ExpiresAt:   expiresAt,
	}, nil
}

func (m *TokenManager) Parse(accessToken string) (uuid.UUID, error) {
	info, err := m.ParseInfo(accessToken)
	if err != nil {
		return uuid.Nil, err
	}
	return info.UserID, nil
}

func (m *TokenManager) ParseInfo(accessToken string) (AccessTokenInfo, error) {
	parsed, err := jwt.ParseWithClaims(accessToken, &accessClaims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected jwt signing method")
		}
		return m.secret, nil
	})
	if err != nil {
		return AccessTokenInfo{}, err
	}

	claims, ok := parsed.Claims.(*accessClaims)
	if !ok || !parsed.Valid {
		return AccessTokenInfo{}, errors.New("invalid jwt claims")
	}
	if claims.Subject == "" {
		return AccessTokenInfo{}, errors.New("missing jwt subject")
	}
	if claims.ExpiresAt == nil {
		return AccessTokenInfo{}, errors.New("missing jwt expiry")
	}

	userID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return AccessTokenInfo{}, err
	}
	return AccessTokenInfo{UserID: userID, AuthVersion: claims.AuthVersion, ExpiresAt: claims.ExpiresAt.Time}, nil
}

func NewRefreshToken() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func TokenHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
