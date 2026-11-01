package auth

import (
	"strings"
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

func TestPasswordLengthRespectsBcryptBytesAndConfiguredPolicy(t *testing.T) {
	cfg := config.PasswordConfig{MinLength: 8, MaxLength: 128}
	if err := ValidatePassword(strings.Repeat("a", 71)+"1", cfg); err != nil {
		t.Fatal(err)
	}
	for _, password := range []string{strings.Repeat("a", 72) + "1", strings.Repeat("中", 24) + "A1", "A1"} {
		err := ValidatePassword(password, cfg)
		details := apperr.DetailsOf(err)
		if details["reason"] != "PASSWORD_LENGTH" || details["minimum"] != 8 || details["maximum"] != 72 {
			t.Fatalf("expected byte limit, got %v", details)
		}
	}
	cfg.MaxLength = 20
	if d := apperr.DetailsOf(ValidatePassword(strings.Repeat("a", 20)+"1", cfg)); d["maximum"] != 20 {
		t.Fatalf("configured maximum ignored: %v", d)
	}
}
