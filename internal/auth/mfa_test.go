package auth

import (
	"strings"
	"testing"
	"time"

	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db/sqlc"
)

func TestTOTPCodeVerification(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1_800, 0)
	step := now.Unix() / totpPeriod
	code, err := totpCodeAtStep(secret, step)
	if err != nil {
		t.Fatalf("totp code: %v", err)
	}

	usedStep, ok, err := verifyTOTPCode(secret, code, now, nil)
	if err != nil {
		t.Fatalf("verify totp: %v", err)
	}
	if !ok || usedStep != step {
		t.Fatalf("expected valid code at step %d, got ok=%v step=%d", step, ok, usedStep)
	}

	if _, ok, err := verifyTOTPCode(secret, code, now, &usedStep); err != nil || ok {
		t.Fatalf("expected replayed code to fail, ok=%v err=%v", ok, err)
	}
}

func TestMFASecretEncryptionRoundTrip(t *testing.T) {
	service := &Service{authCfg: config.AuthConfig{JWTSecret: "test-secret"}}
	ciphertext, nonce, err := service.encryptMFASecret("JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatalf("encrypt secret: %v", err)
	}
	if string(ciphertext) == "JBSWY3DPEHPK3PXP" {
		t.Fatal("ciphertext should not match plaintext")
	}

	got, err := service.decryptMFASecret(sqlc.UserMfaTotp{
		SecretCiphertext: ciphertext,
		SecretNonce:      nonce,
	})
	if err != nil {
		t.Fatalf("decrypt secret: %v", err)
	}
	if got != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("unexpected secret: %q", got)
	}
}

func TestTOTPAuthURIIncludesIssuerAndSecret(t *testing.T) {
	uri := totpAuthURI("JBSWY3DPEHPK3PXP", "user@example.com")
	if uri == "" {
		t.Fatal("expected uri")
	}
	if want := "secret=JBSWY3DPEHPK3PXP"; !strings.Contains(uri, want) {
		t.Fatalf("expected uri to contain %q, got %q", want, uri)
	}
	if want := "issuer=In-situ+EcoCloud"; !strings.Contains(uri, want) {
		t.Fatalf("expected uri to contain %q, got %q", want, uri)
	}
}
