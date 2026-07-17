package adminauth

import (
	"context"
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
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Email       string     `json:"email"`
	Status      string     `json:"status"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type LoginResult struct {
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	TokenType        string `json:"token_type"`
	ExpiresIn        int64  `json:"expires_in"`
	RefreshExpiresIn int64  `json:"refresh_expires_in"`
	Admin            Admin  `json:"admin"`
}

type LoginInput struct {
	Email       string
	Password    string
	UserAgent   string
	ClientIP    string
	RefreshDays int
}

type Service struct {
	db           *pgxpool.Pool
	tokens       *auth.TokenManager
	accessTTL    time.Duration
	refreshTTL   time.Duration
	maxAttempts  int
	lockDuration time.Duration
}

func NewService(db *pgxpool.Pool, tokens *auth.TokenManager, accessTTL, refreshTTL time.Duration) *Service {
	return &Service{db: db, tokens: tokens, accessTTL: accessTTL, refreshTTL: refreshTTL, maxAttempts: 5, lockDuration: 15 * time.Minute}
}

func (s *Service) Login(ctx context.Context, input LoginInput) (LoginResult, error) {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if email == "" || strings.TrimSpace(input.Password) == "" {
		return LoginResult{}, apperr.New(apperr.KindInvalidArgument, "email and password are required")
	}

	var id uuid.UUID
	var name, storedEmail, passwordHash, status string
	var failedAttempts int
	var lockedUntil *time.Time
	if err := s.db.QueryRow(ctx, `SELECT id, name, email, password_hash, status, failed_attempts, locked_until FROM system_admins WHERE email = $1`, email).Scan(&id, &name, &storedEmail, &passwordHash, &status, &failedAttempts, &lockedUntil); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LoginResult{}, apperr.New(apperr.KindUnauthorized, "invalid administrator credentials")
		}
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "find system administrator", err)
	}
	if status != "active" {
		return LoginResult{}, apperr.New(apperr.KindUnauthorized, "administrator account is disabled")
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return LoginResult{}, apperr.New(apperr.KindRateLimited, "administrator account is temporarily locked")
	}
	if !auth.CheckPassword(passwordHash, input.Password) {
		next := failedAttempts + 1
		var lock *time.Time
		if next >= s.maxAttempts {
			value := time.Now().Add(s.lockDuration)
			lock = &value
		}
		_, _ = s.db.Exec(ctx, `UPDATE system_admins SET failed_attempts = $2, locked_until = $3, updated_at = now() WHERE id = $1`, id, next, lock)
		if lock != nil {
			return LoginResult{}, apperr.New(apperr.KindRateLimited, "administrator account is temporarily locked")
		}
		return LoginResult{}, apperr.New(apperr.KindUnauthorized, "invalid administrator credentials")
	}

	adminID := id
	access, err := s.tokens.Generate(adminID)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "generate administrator access token", err)
	}
	refresh, err := auth.NewRefreshToken()
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "generate administrator refresh token", err)
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO system_admin_refresh_sessions (admin_id, refresh_token_hash, user_agent, client_ip, expires_at) VALUES ($1, $2, $3, $4, $5)`, adminID, auth.TokenHash(refresh), nullable(input.UserAgent), nullable(input.ClientIP), time.Now().Add(s.refreshTTL)); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "create administrator session", err)
	}
	if _, err := s.db.Exec(ctx, `UPDATE system_admins SET failed_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1`, adminID); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "update administrator login", err)
	}
	return LoginResult{AccessToken: access.AccessToken, RefreshToken: refresh, TokenType: access.TokenType, ExpiresIn: access.ExpiresIn, RefreshExpiresIn: int64(s.refreshTTL.Seconds()), Admin: Admin{ID: adminID.String(), Name: name, Email: storedEmail, Status: status}}, nil
}

func (s *Service) Refresh(ctx context.Context, refreshToken, userAgent, clientIP string) (LoginResult, error) {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return LoginResult{}, apperr.New(apperr.KindInvalidArgument, "refresh token is required")
	}
	var sessionID, adminID uuid.UUID
	if err := s.db.QueryRow(ctx, `SELECT id, admin_id FROM system_admin_refresh_sessions WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`, auth.TokenHash(refreshToken)).Scan(&sessionID, &adminID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LoginResult{}, apperr.New(apperr.KindUnauthorized, "administrator refresh session is invalid")
		}
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "find administrator refresh session", err)
	}
	var name, email, status string
	if err := s.db.QueryRow(ctx, `SELECT name, email, status FROM system_admins WHERE id = $1`, adminID).Scan(&name, &email, &status); err != nil || status != "active" {
		return LoginResult{}, apperr.New(apperr.KindUnauthorized, "administrator account is unavailable")
	}
	access, err := s.tokens.Generate(adminID)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "generate administrator access token", err)
	}
	newRefresh, err := auth.NewRefreshToken()
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "generate administrator refresh token", err)
	}
	if _, err := s.db.Exec(ctx, `UPDATE system_admin_refresh_sessions SET refresh_token_hash = $2, user_agent = $3, client_ip = $4, expires_at = $5, last_used_at = now(), updated_at = now() WHERE id = $1`, sessionID, auth.TokenHash(newRefresh), nullable(userAgent), nullable(clientIP), time.Now().Add(s.refreshTTL)); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "rotate administrator refresh session", err)
	}
	return LoginResult{AccessToken: access.AccessToken, RefreshToken: newRefresh, TokenType: access.TokenType, ExpiresIn: access.ExpiresIn, RefreshExpiresIn: int64(s.refreshTTL.Seconds()), Admin: Admin{ID: adminID.String(), Name: name, Email: email, Status: status}}, nil
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	if strings.TrimSpace(refreshToken) == "" {
		return nil
	}
	_, err := s.db.Exec(ctx, `UPDATE system_admin_refresh_sessions SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE refresh_token_hash = $1`, auth.TokenHash(refreshToken))
	return err
}

func (s *Service) LookupActor(ctx context.Context, id string) (auth.Actor, error) {
	adminID := parseUUID(id)
	if adminID == uuid.Nil {
		return auth.Actor{}, apperr.New(apperr.KindUnauthorized, "invalid administrator id")
	}
	var name, email, status string
	if err := s.db.QueryRow(ctx, `SELECT name, email, status FROM system_admins WHERE id = $1`, adminID).Scan(&name, &email, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return auth.Actor{}, apperr.New(apperr.KindUnauthorized, "administrator is not active")
		}
		return auth.Actor{}, apperr.Wrap(apperr.KindInternal, "find administrator", err)
	}
	if status != "active" {
		return auth.Actor{}, apperr.New(apperr.KindUnauthorized, "administrator is not active")
	}
	return auth.Actor{UserID: adminID, Name: name, Email: &email, Status: status, IsSystemAdmin: true}, nil
}

func nullable(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func parseUUID(value string) uuid.UUID { id, _ := uuid.Parse(value); return id }
