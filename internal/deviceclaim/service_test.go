package deviceclaim

import (
	"strings"
	"testing"
)

func TestManualCodeNormalizationAndFormatting(t *testing.T) {
	raw := "ab cd-ef12\t34"
	if got := normalizeManualCode(raw); got != "ABCDEF1234" {
		t.Fatalf("normalizeManualCode() = %q", got)
	}
	if got := formatManualCode(raw); got != "ABCD-EF12-34" {
		t.Fatalf("formatManualCode() = %q", got)
	}
}

func TestRandomCredentialShape(t *testing.T) {
	slug, err := randomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	if len(slug) < 40 || strings.ContainsAny(slug, "+/=") {
		t.Fatalf("unexpected URL-safe slug %q", slug)
	}
	code, err := randomManualCode(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 10 {
		t.Fatalf("manual code length = %d", len(code))
	}
	for _, char := range code {
		if !strings.ContainsRune(manualAlphabet, char) {
			t.Fatalf("manual code contains unsupported character %q", char)
		}
	}
}

func TestCredentialEncryptionRoundTrip(t *testing.T) {
	service := NewService(nil, "test-secret")
	ciphertext, nonce, err := service.encrypt("permanent-claim-token")
	if err != nil {
		t.Fatal(err)
	}
	plain, err := service.decrypt(ciphertext, nonce)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "permanent-claim-token" {
		t.Fatalf("decrypt() = %q", plain)
	}
}
