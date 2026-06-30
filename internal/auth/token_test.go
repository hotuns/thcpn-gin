package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestTokenManagerGenerateAndParse(t *testing.T) {
	userID := uuid.New()
	manager := NewTokenManager("test-secret", time.Hour)

	token, err := manager.Generate(userID)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	if token.TokenType != "Bearer" {
		t.Fatalf("expected bearer token type, got %q", token.TokenType)
	}
	if token.ExpiresIn != int64(time.Hour.Seconds()) {
		t.Fatalf("expected expires_in %d, got %d", int64(time.Hour.Seconds()), token.ExpiresIn)
	}

	parsedUserID, err := manager.Parse(token.AccessToken)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	if parsedUserID != userID {
		t.Fatalf("expected user id %s, got %s", userID, parsedUserID)
	}
	info, err := manager.ParseInfo(token.AccessToken)
	if err != nil {
		t.Fatalf("parse token info: %v", err)
	}
	if info.UserID != userID || info.ExpiresAt.IsZero() {
		t.Fatalf("unexpected token info: %#v", info)
	}
}

func TestTokenManagerRejectsExpiredToken(t *testing.T) {
	userID := uuid.New()
	manager := NewTokenManager("test-secret", -time.Minute)

	token, err := manager.Generate(userID)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	if _, err := manager.Parse(token.AccessToken); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}

func TestTokenManagerRejectsWrongSignature(t *testing.T) {
	userID := uuid.New()
	manager := NewTokenManager("test-secret", time.Hour)

	token, err := manager.Generate(userID)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	otherManager := NewTokenManager("other-secret", time.Hour)
	if _, err := otherManager.Parse(token.AccessToken); err == nil {
		t.Fatal("expected token signed by another secret to be rejected")
	}
}

func TestTokenManagerRejectsMissingSubject(t *testing.T) {
	rawToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	signed, err := rawToken.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	manager := NewTokenManager("test-secret", time.Hour)
	if _, err := manager.Parse(signed); err == nil {
		t.Fatal("expected token without subject to be rejected")
	}
}

func TestRefreshTokenGenerationAndHash(t *testing.T) {
	first, err := NewRefreshToken()
	if err != nil {
		t.Fatalf("generate first refresh token: %v", err)
	}
	second, err := NewRefreshToken()
	if err != nil {
		t.Fatalf("generate second refresh token: %v", err)
	}
	if first == "" || second == "" {
		t.Fatal("expected non-empty refresh tokens")
	}
	if first == second {
		t.Fatal("expected refresh tokens to be random")
	}
	if TokenHash(first) == first || TokenHash(first) != TokenHash(first) {
		t.Fatal("expected stable non-plaintext token hash")
	}
}
