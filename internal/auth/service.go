package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db/sqlc"
	smsx "thcpn-gin/internal/sms"
)

const ownerRoleCode = "owner"

type Service struct {
	db        *pgxpool.Pool
	queries   *sqlc.Queries
	tokens    *TokenManager
	codeStore *SMSCodeStore
	sender    smsx.Sender
	authCfg   config.AuthConfig
	smsCfg    config.SMSConfig
	now       func() time.Time
}

type UserProfile struct {
	ID              uuid.UUID  `json:"id"`
	Name            string     `json:"name"`
	Phone           *string    `json:"phone,omitempty"`
	Email           *string    `json:"email,omitempty"`
	Status          string     `json:"status"`
	PhoneVerifiedAt *time.Time `json:"phone_verified_at,omitempty"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	LastLoginAt     *time.Time `json:"last_login_at,omitempty"`
}

type SendSMSInput struct {
	Phone string
}

type SendSMSResult struct {
	Sent            bool `json:"sent"`
	ExpiresIn       int  `json:"expires_in"`
	CooldownSeconds int  `json:"cooldown_seconds"`
}

type SMSLoginInput struct {
	Phone string
	Code  string
	Name  string
}

type PasswordRegisterInput struct {
	Name     string
	Phone    string
	Email    string
	Password string
}

type PasswordLoginInput struct {
	Identifier string
	Password   string
}

type LoginResult struct {
	AccessToken string      `json:"access_token"`
	TokenType   string      `json:"token_type"`
	ExpiresIn   int64       `json:"expires_in"`
	User        UserProfile `json:"user"`
	Created     bool        `json:"created,omitempty"`
}

func NewService(db *pgxpool.Pool, tokens *TokenManager, codeStore *SMSCodeStore, sender smsx.Sender, authCfg config.AuthConfig, smsCfg config.SMSConfig) *Service {
	return &Service{
		db:        db,
		queries:   sqlc.New(db),
		tokens:    tokens,
		codeStore: codeStore,
		sender:    sender,
		authCfg:   authCfg,
		smsCfg:    smsCfg,
		now:       time.Now,
	}
}

func (s *Service) SendSMS(ctx context.Context, input SendSMSInput) (SendSMSResult, error) {
	phone, err := NormalizePhone(input.Phone)
	if err != nil {
		return SendSMSResult{}, err
	}
	if s.codeStore == nil {
		return SendSMSResult{}, apperr.New(apperr.KindInternal, "sms code store is not configured")
	}
	if s.sender == nil {
		return SendSMSResult{}, apperr.New(apperr.KindInternal, "sms sender is not configured")
	}

	code, err := s.codeStore.Issue(ctx, phone)
	if err != nil {
		return SendSMSResult{}, err
	}

	if err := s.sender.SendVerificationCode(ctx, smsx.SendRequest{Phone: phone, Code: code}); err != nil {
		_ = s.codeStore.ClearIssue(ctx, phone)
		return SendSMSResult{}, err
	}

	return SendSMSResult{
		Sent:            true,
		ExpiresIn:       s.smsCfg.CodeTTLSeconds,
		CooldownSeconds: s.smsCfg.CooldownSeconds,
	}, nil
}

func (s *Service) LoginWithSMS(ctx context.Context, input SMSLoginInput) (LoginResult, error) {
	phone, err := NormalizePhone(input.Phone)
	if err != nil {
		return LoginResult{}, err
	}
	code := strings.TrimSpace(input.Code)
	if code == "" {
		return LoginResult{}, apperr.New(apperr.KindInvalidArgument, "sms code is required")
	}
	if s.codeStore == nil {
		return LoginResult{}, apperr.New(apperr.KindInternal, "sms code store is not configured")
	}
	if err := s.codeStore.Verify(ctx, phone, code); err != nil {
		return LoginResult{}, err
	}

	phonePtr := &phone
	userModel, err := s.queries.FindActiveUserByPhoneForAuth(ctx, phonePtr)
	if err == nil {
		userModel, err = s.queries.UpdateUserPhoneVerifiedAndLogin(ctx, userModel.ID)
		if err != nil {
			return LoginResult{}, apperr.Wrap(apperr.KindInternal, "update sms login user", err)
		}
		return s.loginResult(userModel, false)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "find user by phone", err)
	}

	userModel, err = s.createSMSUser(ctx, input.Name, phone)
	if err != nil {
		return LoginResult{}, err
	}
	return s.loginResult(userModel, true)
}

func (s *Service) RegisterWithPassword(ctx context.Context, input PasswordRegisterInput) (LoginResult, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "User"
	}

	phone, err := normalizeOptionalPhone(input.Phone)
	if err != nil {
		return LoginResult{}, err
	}
	email := normalizeOptionalEmail(input.Email)
	if phone == nil && email == nil {
		return LoginResult{}, apperr.New(apperr.KindInvalidArgument, "phone or email is required")
	}
	if err := ValidatePassword(input.Password, s.authCfg.Password); err != nil {
		return LoginResult{}, err
	}

	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "hash password", err)
	}

	userModel, err := s.createPasswordUser(ctx, name, phone, email, passwordHash)
	if err != nil {
		return LoginResult{}, err
	}
	return s.loginResult(userModel, true)
}

func (s *Service) LoginWithPassword(ctx context.Context, input PasswordLoginInput) (LoginResult, error) {
	identifier, err := normalizeIdentifier(input.Identifier)
	if err != nil {
		return LoginResult{}, err
	}
	if strings.TrimSpace(input.Password) == "" {
		return LoginResult{}, apperr.New(apperr.KindInvalidArgument, "password is required")
	}

	userModel, err := s.queries.FindActiveUserByIdentifier(ctx, &identifier)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LoginResult{}, apperr.New(apperr.KindUnauthorized, "invalid identifier or password")
		}
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "find user by identifier", err)
	}

	credential, err := s.queries.GetUserCredential(ctx, userModel.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LoginResult{}, apperr.New(apperr.KindUnauthorized, "invalid identifier or password")
		}
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "get user credential", err)
	}
	if credential.LockedUntil.Valid && credential.LockedUntil.Time.After(s.now()) {
		return LoginResult{}, apperr.New(apperr.KindRateLimited, "account is temporarily locked")
	}

	if !CheckPassword(credential.PasswordHash, input.Password) {
		if err := s.recordPasswordFailure(ctx, credential); err != nil {
			return LoginResult{}, err
		}
		return LoginResult{}, apperr.New(apperr.KindUnauthorized, "invalid identifier or password")
	}

	if _, err := s.queries.ResetUserCredentialFailure(ctx, userModel.ID); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "reset password failure count", err)
	}
	userModel, err = s.queries.UpdateUserLastLogin(ctx, userModel.ID)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "update password login user", err)
	}
	return s.loginResult(userModel, false)
}

func (s *Service) createSMSUser(ctx context.Context, name string, phone string) (sqlc.User, error) {
	if strings.TrimSpace(name) == "" {
		name = "User"
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return sqlc.User{}, apperr.Wrap(apperr.KindInternal, "begin sms registration transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	createdUser, err := q.CreateUser(ctx, sqlc.CreateUserParams{
		Name:  name,
		Phone: &phone,
		Email: nil,
	})
	if err != nil {
		return sqlc.User{}, mapCreateUserError(err)
	}

	if err := createPersonalWorkspaceMembership(ctx, q, createdUser.ID, name); err != nil {
		return sqlc.User{}, err
	}

	createdUser, err = q.UpdateUserPhoneVerifiedAndLogin(ctx, createdUser.ID)
	if err != nil {
		return sqlc.User{}, apperr.Wrap(apperr.KindInternal, "mark phone verified", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return sqlc.User{}, apperr.Wrap(apperr.KindInternal, "commit sms registration transaction", err)
	}
	committed = true
	return createdUser, nil
}

func (s *Service) createPasswordUser(ctx context.Context, name string, phone *string, email *string, passwordHash string) (sqlc.User, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return sqlc.User{}, apperr.Wrap(apperr.KindInternal, "begin password registration transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	createdUser, err := q.CreateUser(ctx, sqlc.CreateUserParams{
		Name:  name,
		Phone: phone,
		Email: email,
	})
	if err != nil {
		return sqlc.User{}, mapCreateUserError(err)
	}
	if _, err := q.CreateUserCredential(ctx, sqlc.CreateUserCredentialParams{
		UserID:       createdUser.ID,
		PasswordHash: passwordHash,
	}); err != nil {
		return sqlc.User{}, mapCredentialWriteError(err, "create user credential")
	}
	if err := createPersonalWorkspaceMembership(ctx, q, createdUser.ID, name); err != nil {
		return sqlc.User{}, err
	}
	createdUser, err = q.UpdateUserLastLogin(ctx, createdUser.ID)
	if err != nil {
		return sqlc.User{}, apperr.Wrap(apperr.KindInternal, "mark password registration login", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return sqlc.User{}, apperr.Wrap(apperr.KindInternal, "commit password registration transaction", err)
	}
	committed = true
	return createdUser, nil
}

func createPersonalWorkspaceMembership(ctx context.Context, q *sqlc.Queries, userID uuid.UUID, userName string) error {
	ownerRole, err := q.GetSystemRoleByCode(ctx, ownerRoleCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.New(apperr.KindInternal, "owner role is not seeded")
		}
		return apperr.Wrap(apperr.KindInternal, "get owner role", err)
	}

	workspace, err := q.CreatePersonalWorkspace(ctx, sqlc.CreatePersonalWorkspaceParams{
		Name:        personalWorkspaceName(userName),
		OwnerUserID: userID,
	})
	if err != nil {
		return mapWriteError(err, "create personal workspace")
	}

	if _, err := q.CreateWorkspaceMember(ctx, sqlc.CreateWorkspaceMemberParams{
		WorkspaceID: workspace.ID,
		UserID:      userID,
		RoleID:      ownerRole.ID,
	}); err != nil {
		return mapWriteError(err, "create workspace membership")
	}
	return nil
}

func (s *Service) recordPasswordFailure(ctx context.Context, credential sqlc.UserCredential) error {
	nextAttempts := credential.FailedAttempts + 1
	var lockedUntil pgtype.Timestamptz
	if nextAttempts >= int32(s.authCfg.Password.FailedAttemptLimit) {
		lockedUntil = pgtype.Timestamptz{
			Time:  s.now().Add(time.Duration(s.authCfg.Password.LockMinutes) * time.Minute),
			Valid: true,
		}
	}
	if _, err := s.queries.UpdateUserCredentialFailure(ctx, sqlc.UpdateUserCredentialFailureParams{
		UserID:         credential.UserID,
		FailedAttempts: nextAttempts,
		LockedUntil:    lockedUntil,
	}); err != nil {
		return apperr.Wrap(apperr.KindInternal, "record password failure", err)
	}
	if lockedUntil.Valid {
		return apperr.New(apperr.KindRateLimited, "account is temporarily locked")
	}
	return nil
}

func (s *Service) loginResult(userModel sqlc.User, created bool) (LoginResult, error) {
	if s.tokens == nil {
		return LoginResult{}, apperr.New(apperr.KindInternal, "token manager is not configured")
	}
	token, err := s.tokens.Generate(userModel.ID)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "generate access token", err)
	}
	return LoginResult{
		AccessToken: token.AccessToken,
		TokenType:   token.TokenType,
		ExpiresIn:   token.ExpiresIn,
		User:        userProfileFromSQL(userModel),
		Created:     created,
	}, nil
}

func userProfileFromSQL(model sqlc.User) UserProfile {
	return UserProfile{
		ID:              model.ID,
		Name:            model.Name,
		Phone:           model.Phone,
		Email:           model.Email,
		Status:          model.Status,
		PhoneVerifiedAt: pgTimePtr(model.PhoneVerifiedAt),
		EmailVerifiedAt: pgTimePtr(model.EmailVerifiedAt),
		LastLoginAt:     pgTimePtr(model.LastLoginAt),
	}
}

func normalizeOptionalPhone(phone string) (*string, error) {
	if strings.TrimSpace(phone) == "" {
		return nil, nil
	}
	normalized, err := NormalizePhone(phone)
	if err != nil {
		return nil, err
	}
	return &normalized, nil
}

func normalizeOptionalEmail(email string) *string {
	normalized := strings.ToLower(strings.TrimSpace(email))
	if normalized == "" {
		return nil
	}
	return &normalized
}

func normalizeIdentifier(identifier string) (string, error) {
	trimmed := strings.TrimSpace(identifier)
	if trimmed == "" {
		return "", apperr.New(apperr.KindInvalidArgument, "identifier is required")
	}
	if strings.Contains(trimmed, "@") {
		return strings.ToLower(trimmed), nil
	}
	return NormalizePhone(trimmed)
}

func personalWorkspaceName(name string) string {
	if strings.TrimSpace(name) == "" {
		return "Personal Workspace"
	}
	return strings.TrimSpace(name) + " Personal Workspace"
}

func pgTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func mapCreateUserError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return apperr.Wrap(apperr.KindConflict, "phone or email already exists", err)
		case "23514":
			return apperr.Wrap(apperr.KindInvalidArgument, "phone or email is required", err)
		}
	}
	return apperr.Wrap(apperr.KindInternal, "create user", err)
}

func mapCredentialWriteError(err error, message string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return apperr.Wrap(apperr.KindConflict, "credential already exists", err)
		case "23503", "23514":
			return apperr.Wrap(apperr.KindInvalidArgument, message, err)
		}
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}

func mapWriteError(err error, message string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return apperr.Wrap(apperr.KindConflict, "resource already exists", err)
		case "23503", "23514":
			return apperr.Wrap(apperr.KindInvalidArgument, message, err)
		}
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
