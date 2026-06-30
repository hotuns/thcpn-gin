package auth

import (
	"testing"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestValidatePassword(t *testing.T) {
	cfg := config.PasswordConfig{
		MinLength:          8,
		MaxLength:          128,
		FailedAttemptLimit: 5,
		LockMinutes:        15,
	}

	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "valid", value: "Str0ngPassword!", wantErr: false},
		{name: "too short", value: "A1short", wantErr: true},
		{name: "missing digit", value: "PasswordOnly", wantErr: true},
		{name: "missing letter", value: "12345678", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePassword(tt.value, cfg)
			if tt.wantErr && apperr.KindOf(err) != apperr.KindInvalidArgument {
				t.Fatalf("expected invalid argument, got %v", err)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("expected password to pass, got %v", err)
			}
		})
	}
}

func TestHashAndCheckPassword(t *testing.T) {
	hash, err := HashPassword("Str0ngPassword!")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if hash == "Str0ngPassword!" {
		t.Fatal("password hash must not equal plaintext")
	}
	if !CheckPassword(hash, "Str0ngPassword!") {
		t.Fatal("expected correct password to pass")
	}
	if CheckPassword(hash, "WrongPassword1") {
		t.Fatal("expected wrong password to fail")
	}
	if CheckPassword("", "Str0ngPassword!") {
		t.Fatal("expected empty hash to fail")
	}
}
