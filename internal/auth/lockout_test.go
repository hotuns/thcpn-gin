package auth

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"testing"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestExpiredUserLockStartsNewFailureWindow(t *testing.T) {
	db := testdb.Open(t, 0)
	id := uuid.New()
	now := time.Now()
	if _, err := db.Exec(t.Context(), `INSERT INTO users (id,name,email) VALUES ($1,'Test lockout',$2)`, id, id.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(db)
	if _, err := q.CreateUserCredential(t.Context(), sqlc.CreateUserCredentialParams{UserID: id, PasswordHash: "unused"}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.UpdateUserCredentialFailure(t.Context(), sqlc.UpdateUserCredentialFailureParams{UserID: id, FailedAttempts: 6, LockedUntil: pgtype.Timestamptz{Time: now.Add(-time.Minute), Valid: true}}); err != nil {
		t.Fatal(err)
	}
	service := &Service{queries: q, now: func() time.Time { return now }, authCfg: config.AuthConfig{Password: config.PasswordConfig{FailedAttemptLimit: 5, LockMinutes: 15}}}
	for attempt := 1; attempt <= 5; attempt++ {
		credential, err := q.GetUserCredential(t.Context(), id)
		if err != nil {
			t.Fatal(err)
		}
		err = service.recordPasswordFailure(t.Context(), credential)
		if attempt < 5 && err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
		if attempt == 5 && apperr.DetailsOf(err)["reason"] != "ACCOUNT_LOCKED" {
			t.Fatalf("missing lock: %v", err)
		}
	}
}
