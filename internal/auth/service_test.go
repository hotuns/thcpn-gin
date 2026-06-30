package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"thcpn-gin/internal/db/sqlc"
)

func TestSessionFromSQL(t *testing.T) {
	sessionID := uuid.New()
	userAgent := "Codex Browser"
	clientIP := "127.0.0.1"
	expiresAt := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	lastUsedAt := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

	item := sessionFromSQL(sqlc.AuthRefreshSession{
		ID:        sessionID,
		UserAgent: &userAgent,
		ClientIp:  &clientIP,
		ExpiresAt: pgtype.Timestamptz{
			Time:  expiresAt,
			Valid: true,
		},
		LastUsedAt: pgtype.Timestamptz{
			Time:  lastUsedAt,
			Valid: true,
		},
		CreatedAt: pgtype.Timestamptz{
			Time:  createdAt,
			Valid: true,
		},
	})

	if item.ID != sessionID {
		t.Fatalf("unexpected session id: %s", item.ID)
	}
	if item.UserAgent == nil || *item.UserAgent != userAgent {
		t.Fatalf("unexpected user agent: %#v", item.UserAgent)
	}
	if item.ClientIP == nil || *item.ClientIP != clientIP {
		t.Fatalf("unexpected client ip: %#v", item.ClientIP)
	}
	if !item.ExpiresAt.Equal(expiresAt) || item.LastUsedAt == nil || !item.LastUsedAt.Equal(lastUsedAt) || !item.CreatedAt.Equal(createdAt) {
		t.Fatalf("unexpected times: %#v", item)
	}
}
