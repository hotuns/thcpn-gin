package auth

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestSMSCodeStoreIssueAndVerifyDeletesCode(t *testing.T) {
	store, redisServer := newTestSMSCodeStore(t, config.SMSConfig{
		CodeTTLSeconds:    300,
		CooldownSeconds:   60,
		DailyLimit:        10,
		MaxVerifyAttempts: 5,
	})

	code, err := store.Issue(context.Background(), "13800000000")
	if err != nil {
		t.Fatalf("issue code: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("expected 6 digit code, got %q", code)
	}
	if err := store.Verify(context.Background(), "13800000000", code); err != nil {
		t.Fatalf("verify code: %v", err)
	}
	if err := store.Verify(context.Background(), "13800000000", code); apperr.KindOf(err) != apperr.KindUnauthorized {
		t.Fatalf("expected code to be deleted after success, got %v", err)
	}

	redisServer.FastForward(0)
}

func TestSMSCodeStoreEnforcesCooldown(t *testing.T) {
	store, _ := newTestSMSCodeStore(t, config.SMSConfig{
		CodeTTLSeconds:    300,
		CooldownSeconds:   60,
		DailyLimit:        10,
		MaxVerifyAttempts: 5,
	})

	if _, err := store.Issue(context.Background(), "13800000000"); err != nil {
		t.Fatalf("issue first code: %v", err)
	}
	if _, err := store.Issue(context.Background(), "13800000000"); apperr.KindOf(err) != apperr.KindRateLimited {
		t.Fatalf("expected cooldown rate limit, got %v", err)
	}
}

func TestSMSCodeStoreEnforcesDailyLimit(t *testing.T) {
	store, redisServer := newTestSMSCodeStore(t, config.SMSConfig{
		CodeTTLSeconds:    300,
		CooldownSeconds:   1,
		DailyLimit:        1,
		MaxVerifyAttempts: 5,
	})

	if _, err := store.Issue(context.Background(), "13800000000"); err != nil {
		t.Fatalf("issue first code: %v", err)
	}
	redisServer.FastForward(2 * time.Second)
	if _, err := store.Issue(context.Background(), "13800000000"); apperr.KindOf(err) != apperr.KindRateLimited {
		t.Fatalf("expected daily rate limit, got %v", err)
	}
}

func TestSMSCodeStoreDeletesAfterMaxAttempts(t *testing.T) {
	store, _ := newTestSMSCodeStore(t, config.SMSConfig{
		CodeTTLSeconds:    300,
		CooldownSeconds:   60,
		DailyLimit:        10,
		MaxVerifyAttempts: 2,
	})

	code, err := store.Issue(context.Background(), "13800000000")
	if err != nil {
		t.Fatalf("issue code: %v", err)
	}
	if err := store.Verify(context.Background(), "13800000000", "000000"); apperr.KindOf(err) != apperr.KindUnauthorized {
		t.Fatalf("expected wrong code to fail, got %v", err)
	}
	if err := store.Verify(context.Background(), "13800000000", "111111"); apperr.KindOf(err) != apperr.KindUnauthorized {
		t.Fatalf("expected second wrong code to fail, got %v", err)
	}
	if err := store.Verify(context.Background(), "13800000000", code); apperr.KindOf(err) != apperr.KindUnauthorized {
		t.Fatalf("expected code to be deleted after max attempts, got %v", err)
	}
}

func TestSMSCodeStoreExpiresCode(t *testing.T) {
	store, redisServer := newTestSMSCodeStore(t, config.SMSConfig{
		CodeTTLSeconds:    1,
		CooldownSeconds:   60,
		DailyLimit:        10,
		MaxVerifyAttempts: 5,
	})

	code, err := store.Issue(context.Background(), "13800000000")
	if err != nil {
		t.Fatalf("issue code: %v", err)
	}
	redisServer.FastForward(2 * time.Second)
	if err := store.Verify(context.Background(), "13800000000", code); apperr.KindOf(err) != apperr.KindUnauthorized {
		t.Fatalf("expected expired code to fail, got %v", err)
	}
}

func TestEmailCodeStoreIssueAndVerifyDeletesCode(t *testing.T) {
	store, _ := newTestEmailCodeStore(t, config.EmailConfig{
		CodeTTLSeconds:    300,
		CooldownSeconds:   60,
		DailyLimit:        10,
		MaxVerifyAttempts: 5,
	})

	code, err := store.Issue(context.Background(), "user@example.com")
	if err != nil {
		t.Fatalf("issue email code: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("expected 6 digit code, got %q", code)
	}
	raw, err := store.store.redis.Get(context.Background(), "auth:email:code:"+hashSubject("user@example.com")).Result()
	if err != nil {
		t.Fatalf("get stored email code record: %v", err)
	}
	if strings.Contains(raw, code) {
		t.Fatalf("email code record should not contain plaintext code: %s", raw)
	}
	if err := store.Verify(context.Background(), "user@example.com", code); err != nil {
		t.Fatalf("verify email code: %v", err)
	}
	if err := store.Verify(context.Background(), "user@example.com", code); apperr.KindOf(err) != apperr.KindUnauthorized {
		t.Fatalf("expected code to be deleted after success, got %v", err)
	}
}

func newTestSMSCodeStore(t *testing.T, cfg config.SMSConfig) (*SMSCodeStore, *miniredis.Miniredis) {
	t.Helper()

	redisServer := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() {
		_ = client.Close()
	})

	return NewSMSCodeStore(client, "test-secret", cfg), redisServer
}

func newTestEmailCodeStore(t *testing.T, cfg config.EmailConfig) (*EmailCodeStore, *miniredis.Miniredis) {
	t.Helper()

	redisServer := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() {
		_ = client.Close()
	})

	return NewEmailCodeStore(client, "test-secret", cfg), redisServer
}
