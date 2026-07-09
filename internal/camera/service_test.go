package camera

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestNormalizeBindingInput(t *testing.T) {
	input, err := normalizeBindingInput(" C123 ", 0, "", "", " env:CODE ")
	if err != nil {
		t.Fatalf("normalize binding: %v", err)
	}
	if input.deviceSerial != "C123" || input.channelNo != 1 || input.defaultQuality != "hd" || input.status != "active" {
		t.Fatalf("unexpected normalized input: %#v", input)
	}
	if input.validateCodeSecretRef == nil || *input.validateCodeSecretRef != "env:CODE" {
		t.Fatalf("expected validate code secret ref to be trimmed")
	}
}

func TestNormalizeBindingRejectsInvalidQuality(t *testing.T) {
	_, err := normalizeBindingInput("C123", 1, "4k", "active", "")
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestEzopenLiveURL(t *testing.T) {
	if got := ezopenLiveURL("ABC123", 2, "hd"); got != "ezopen://open.ys7.com/ABC123/2.hd.live" {
		t.Fatalf("unexpected hd url %q", got)
	}
	if got := ezopenLiveURL("ABC123", 1, "standard"); got != "ezopen://open.ys7.com/ABC123/1.live" {
		t.Fatalf("unexpected standard url %q", got)
	}
}

func TestAccessTokenCache(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":"200","data":{"accessToken":"token-1","expireTime":4102444800000}}`))
	}))
	defer server.Close()

	t.Setenv("TEST_EZVIZ_KEY", "app-key")
	t.Setenv("TEST_EZVIZ_SECRET", "app-secret")
	now := time.Date(2026, 7, 9, 0, 0, 0, 0, time.UTC)
	service := NewService(nil, config.EzvizConfig{
		AppKeyEnv:             "TEST_EZVIZ_KEY",
		AppSecretEnv:          "TEST_EZVIZ_SECRET",
		OpenAPIDomain:         server.URL,
		AccessTokenTTLSeconds: 120,
	})
	service.now = func() time.Time { return now }

	first, _, err := service.accessToken(context.Background())
	if err != nil {
		t.Fatalf("first access token: %v", err)
	}
	second, _, err := service.accessToken(context.Background())
	if err != nil {
		t.Fatalf("second access token: %v", err)
	}
	if first != "token-1" || second != "token-1" {
		t.Fatalf("unexpected tokens: %q %q", first, second)
	}
	if calls != 1 {
		t.Fatalf("expected token to be cached, got %d calls", calls)
	}
}
