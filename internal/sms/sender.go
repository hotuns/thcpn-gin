package sms

import (
	"context"
	"log/slog"
)

type SendRequest struct {
	Phone        string
	Code         string
	TemplateCode string
}

type Sender interface {
	SendVerificationCode(ctx context.Context, req SendRequest) error
}

type VerifyRequest struct {
	Phone string
	Code  string
}

type Verifier interface {
	VerifyVerificationCode(ctx context.Context, req VerifyRequest) error
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
		s.Logger.InfoContext(ctx, "sms verification code", slog.String("phone", req.Phone), slog.String("code", req.Code))
	}
	return nil
}
