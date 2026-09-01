package email

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestEmailSenders(t *testing.T) {
	req := SendRequest{Email: "user@example.com", Code: "123456"}
	if err := (NoopSender{}).SendVerificationCode(context.Background(), req); err != nil {
		t.Fatalf("noop sender: %v", err)
	}
	var output bytes.Buffer
	sender := LogSender{Logger: slog.New(slog.NewTextHandler(&output, nil))}
	if err := sender.SendVerificationCode(context.Background(), req); err != nil {
		t.Fatalf("log sender: %v", err)
	}
	if text := output.String(); !strings.Contains(text, "user@example.com") || !strings.Contains(text, "123456") {
		t.Fatalf("expected recipient and code in log output, got %q", text)
	}
	if err := (LogSender{}).SendVerificationCode(context.Background(), req); err != nil {
		t.Fatalf("nil logger: %v", err)
	}
}
