package email

import (
	"context"
	"log/slog"
)

type SendRequest struct {
	Email string
	Code  string
}

type Sender interface {
	SendVerificationCode(ctx context.Context, req SendRequest) error
}

type NoopSender struct{}

func (NoopSender) SendVerificationCode(context.Context, SendRequest) error {
	return nil
}

type LogSender struct {
	Logger *slog.Logger
}

func (s LogSender) SendVerificationCode(ctx context.Context, req SendRequest) error {
	if s.Logger != nil {
		s.Logger.InfoContext(ctx, "email verification code", slog.String("email", req.Email), slog.String("code", req.Code))
	}
	return nil
}
