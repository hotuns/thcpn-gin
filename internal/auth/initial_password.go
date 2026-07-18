package auth

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

const passwordChangeSessionTTL = 10 * time.Minute

type CompleteInitialPasswordInput struct {
	Token    string
	Password string
	Request  RequestInfo
}

func (s *Service) passwordChangeRequired(ctx context.Context, userID uuid.UUID) (bool, error) {
	var required bool
	if err := s.db.QueryRow(ctx, `SELECT must_change_password FROM user_credentials WHERE user_id = $1`, userID).Scan(&required); err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, apperr.Wrap(apperr.KindInternal, "get password change state", err)
	}
	return required, nil
}

func (s *Service) issuePasswordChangeSession(ctx context.Context, userID uuid.UUID) (string, int64, error) {
	token, err := NewRefreshToken()
	if err != nil {
		return "", 0, apperr.Wrap(apperr.KindInternal, "generate password change token", err)
	}
	expiresAt := s.now().Add(passwordChangeSessionTTL)
	if _, err := s.db.Exec(ctx, `UPDATE auth_password_change_sessions SET used_at = COALESCE(used_at, now()) WHERE user_id = $1 AND used_at IS NULL`, userID); err != nil {
		return "", 0, apperr.Wrap(apperr.KindInternal, "expire password change sessions", err)
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO auth_password_change_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, TokenHash(token), expiresAt); err != nil {
		return "", 0, apperr.Wrap(apperr.KindInternal, "store password change session", err)
	}
	return token, int64(passwordChangeSessionTTL.Seconds()), nil
}

func (s *Service) initialPasswordResult(ctx context.Context, userModel sqlc.User, created bool) (LoginResult, error) {
	token, expiresIn, err := s.issuePasswordChangeSession(ctx, userModel.ID)
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{
		User:                    userProfileFromSQL(userModel),
		Created:                 created,
		PasswordChangeRequired:  true,
		PasswordChangeToken:     token,
		PasswordChangeExpiresIn: expiresIn,
	}, nil
}

func (s *Service) CompleteInitialPassword(ctx context.Context, input CompleteInitialPasswordInput) (LoginResult, error) {
	if strings.TrimSpace(input.Token) == "" {
		return LoginResult{}, apperr.New(apperr.KindInvalidArgument, "password_change_token is required")
	}
	if err := ValidatePassword(input.Password, s.authCfg.Password); err != nil {
		return LoginResult{}, err
	}
	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "hash password", err)
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "begin password completion", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var userID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT user_id FROM auth_password_change_sessions WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, TokenHash(input.Token)).Scan(&userID); err != nil {
		if err == pgx.ErrNoRows {
			return LoginResult{}, apperr.New(apperr.KindUnauthorized, "password change token is invalid or expired")
		}
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "get password change session", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE user_credentials SET password_hash = $2, must_change_password = false, failed_attempts = 0, locked_until = NULL, password_updated_at = now(), updated_at = now() WHERE user_id = $1`, userID, passwordHash); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "complete initial password", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_password_change_sessions SET used_at = now() WHERE token_hash = $1`, TokenHash(input.Token)); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "consume password change token", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET auth_version = auth_version + 1, updated_at = now() WHERE id = $1`, userID); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "invalidate old user tokens", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "revoke old user sessions", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "commit password completion", err)
	}
	userModel, err := s.queries.GetActiveUser(ctx, userID)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "load completed password user", err)
	}
	return s.loginResult(ctx, userModel, false, input.Request)
}
