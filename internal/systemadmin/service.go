package systemadmin

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
)

type Admin struct {
	ID             uuid.UUID  `json:"id"`
	Name           string     `json:"name"`
	Email          string     `json:"email"`
	Status         string     `json:"status"`
	FailedAttempts int        `json:"failed_attempts"`
	LockedUntil    *time.Time `json:"locked_until,omitempty"`
	LastLoginAt    *time.Time `json:"last_login_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

func (s *Service) List(ctx context.Context) ([]Admin, error) {
	rows, err := s.db.Query(ctx, `SELECT id,name,email,status,failed_attempts,locked_until,last_login_at,created_at,updated_at FROM system_admins ORDER BY created_at, id`)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list system administrators", err)
	}
	defer rows.Close()
	items := []Admin{}
	for rows.Next() {
		var item Admin
		if err := rows.Scan(&item.ID, &item.Name, &item.Email, &item.Status, &item.FailedAttempts, &item.LockedUntil, &item.LastLoginAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan system administrator", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Create(ctx context.Context, name, email, password string) (Admin, string, error) {
	name, email = strings.TrimSpace(name), strings.ToLower(strings.TrimSpace(email))
	if name == "" || email == "" {
		return Admin{}, "", apperr.New(apperr.KindInvalidArgument, "name and email are required")
	}
	if password == "" {
		var err error
		password, err = temporaryPassword()
		if err != nil {
			return Admin{}, "", err
		}
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return Admin{}, "", apperr.Wrap(apperr.KindInternal, "hash administrator password", err)
	}
	var item Admin
	err = s.db.QueryRow(ctx, `INSERT INTO system_admins (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,status,failed_attempts,locked_until,last_login_at,created_at,updated_at`, name, email, hash).Scan(&item.ID, &item.Name, &item.Email, &item.Status, &item.FailedAttempts, &item.LockedUntil, &item.LastLoginAt, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "system_admins_email") || strings.Contains(err.Error(), "duplicate key") {
			return Admin{}, "", apperr.New(apperr.KindConflict, "administrator email already exists")
		}
		return Admin{}, "", apperr.Wrap(apperr.KindInternal, "create system administrator", err)
	}
	return item, password, nil
}

func (s *Service) SetStatus(ctx context.Context, id, actorID uuid.UUID, status string) error {
	if status != "active" && status != "disabled" {
		return apperr.New(apperr.KindInvalidArgument, "invalid administrator status")
	}
	if id == actorID && status == "disabled" {
		return apperr.New(apperr.KindConflict, "you cannot disable your own administrator account")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin administrator status update", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `UPDATE system_admins SET status=$2,updated_at=now() WHERE id=$1`, id, status)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "update administrator status", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "administrator not found")
	}
	if status == "disabled" {
		_, err = tx.Exec(ctx, `UPDATE system_admin_refresh_sessions SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, id)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "revoke administrator sessions", err)
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) Unlock(ctx context.Context, id uuid.UUID) error {
	result, err := s.db.Exec(ctx, `UPDATE system_admins SET failed_attempts=0,locked_until=NULL,updated_at=now() WHERE id=$1`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "unlock administrator", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "administrator not found")
	}
	return nil
}

func (s *Service) RevokeSessions(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.Exec(ctx, `UPDATE system_admin_refresh_sessions SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "revoke administrator sessions", err)
	}
	return nil
}

func (s *Service) ResetPassword(ctx context.Context, id uuid.UUID) (string, error) {
	password, err := temporaryPassword()
	if err != nil {
		return "", err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "hash administrator password", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "begin administrator password reset", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `UPDATE system_admins SET password_hash=$2,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE id=$1`, id, hash)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "reset administrator password", err)
	}
	if result.RowsAffected() == 0 {
		return "", apperr.New(apperr.KindNotFound, "administrator not found")
	}
	if _, err = tx.Exec(ctx, `UPDATE system_admin_refresh_sessions SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, id); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "revoke administrator sessions", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "commit administrator password reset", err)
	}
	return password, nil
}

func temporaryPassword() (string, error) {
	b := make([]byte, 15)
	if _, err := rand.Read(b); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "generate temporary password", err)
	}
	return "A9" + base64.RawURLEncoding.EncodeToString(b), nil
}

func Exists(ctx context.Context, db *pgxpool.Pool, email string) (bool, error) {
	var id uuid.UUID
	err := db.QueryRow(ctx, `SELECT id FROM system_admins WHERE email=$1`, strings.ToLower(strings.TrimSpace(email))).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
