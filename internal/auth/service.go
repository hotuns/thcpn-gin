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
	emailx "thcpn-gin/internal/email"
	smsx "thcpn-gin/internal/sms"
)

const ownerRoleCode = "owner"

type Service struct {
	db             *pgxpool.Pool
	queries        *sqlc.Queries
	tokens         *TokenManager
	codeStore      *SMSCodeStore
	emailCodeStore *EmailCodeStore
	sender         smsx.Sender
	emailSender    emailx.Sender
	authCfg        config.AuthConfig
	smsCfg         config.SMSConfig
	emailCfg       config.EmailConfig
	now            func() time.Time
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

type Session struct {
	ID         uuid.UUID  `json:"id"`
	UserAgent  *string    `json:"user_agent,omitempty"`
	ClientIP   *string    `json:"client_ip,omitempty"`
	ExpiresAt  time.Time  `json:"expires_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type SendSMSInput struct {
	Phone string
}

type SendCodeResult struct {
	Sent            bool `json:"sent"`
	ExpiresIn       int  `json:"expires_in"`
	CooldownSeconds int  `json:"cooldown_seconds"`
}

type SendSMSResult = SendCodeResult

type SendEmailInput struct {
	UserID uuid.UUID
	Email  string
}

type SendEmailResult = SendCodeResult

type SMSLoginInput struct {
	Phone   string
	Code    string
	MFACode string
	Name    string
	Request RequestInfo
}

type PasswordRegisterInput struct {
	Name     string
	Phone    string
	Email    string
	Password string
	Request  RequestInfo
}

type PasswordLoginInput struct {
	Identifier string
	Password   string
	MFACode    string
	Request    RequestInfo
}

type RequestInfo struct {
	UserAgent string
	ClientIP  string
}

type RefreshInput struct {
	RefreshToken string
	Request      RequestInfo
}

type LogoutInput struct {
	AccessToken  string
	RefreshToken string
	UserID       uuid.UUID
}

type ChangePasswordInput struct {
	UserID          uuid.UUID
	CurrentPassword string
	NewPassword     string
}

type ListSessionsInput struct {
	UserID uuid.UUID
}

type RevokeSessionInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
}

type VerifyEmailInput struct {
	UserID uuid.UUID
	Email  string
	Code   string
}

type LoginResult struct {
	AccessToken             string      `json:"access_token"`
	RefreshToken            string      `json:"refresh_token"`
	TokenType               string      `json:"token_type"`
	ExpiresIn               int64       `json:"expires_in"`
	RefreshExpiresIn        int64       `json:"refresh_expires_in"`
	User                    UserProfile `json:"user"`
	Created                 bool        `json:"created,omitempty"`
	PasswordChangeRequired  bool        `json:"password_change_required,omitempty"`
	PasswordChangeToken     string      `json:"password_change_token,omitempty"`
	PasswordChangeExpiresIn int64       `json:"password_change_expires_in,omitempty"`
}

func NewService(db *pgxpool.Pool, tokens *TokenManager, codeStore *SMSCodeStore, sender smsx.Sender, emailCodeStore *EmailCodeStore, emailSender emailx.Sender, authCfg config.AuthConfig, smsCfg config.SMSConfig, emailCfg config.EmailConfig) *Service {
	return &Service{
		db:             db,
		queries:        sqlc.New(db),
		tokens:         tokens,
		codeStore:      codeStore,
		emailCodeStore: emailCodeStore,
		sender:         sender,
		emailSender:    emailSender,
		authCfg:        authCfg,
		smsCfg:         smsCfg,
		emailCfg:       emailCfg,
		now:            time.Now,
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

func (s *Service) SendEmailVerification(ctx context.Context, input SendEmailInput) (SendEmailResult, error) {
	if input.UserID == uuid.Nil {
		return SendEmailResult{}, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	email := normalizeOptionalEmail(input.Email)
	if email == nil {
		return SendEmailResult{}, apperr.New(apperr.KindInvalidArgument, "email is required")
	}
	userModel, err := s.queries.GetActiveUser(ctx, input.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SendEmailResult{}, apperr.New(apperr.KindUnauthorized, "user is not active")
		}
		return SendEmailResult{}, apperr.Wrap(apperr.KindInternal, "get email verification user", err)
	}
	if userModel.Email == nil || *userModel.Email != *email {
		return SendEmailResult{}, apperr.New(apperr.KindInvalidArgument, "email does not match current user")
	}
	if userModel.EmailVerifiedAt.Valid {
		return SendEmailResult{}, apperr.New(apperr.KindConflict, "email is already verified")
	}
	if s.emailCodeStore == nil {
		return SendEmailResult{}, apperr.New(apperr.KindInternal, "email code store is not configured")
	}
	if s.emailSender == nil {
		return SendEmailResult{}, apperr.New(apperr.KindInternal, "email sender is not configured")
	}

	code, err := s.emailCodeStore.Issue(ctx, *email)
	if err != nil {
		return SendEmailResult{}, err
	}

	if err := s.emailSender.SendVerificationCode(ctx, emailx.SendRequest{Email: *email, Code: code}); err != nil {
		_ = s.emailCodeStore.ClearIssue(ctx, *email)
		return SendEmailResult{}, err
	}

	return SendEmailResult{
		Sent:            true,
		ExpiresIn:       s.emailCfg.CodeTTLSeconds,
		CooldownSeconds: s.emailCfg.CooldownSeconds,
	}, nil
}

func (s *Service) VerifyEmail(ctx context.Context, input VerifyEmailInput) (UserProfile, error) {
	if input.UserID == uuid.Nil {
		return UserProfile{}, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	email := normalizeOptionalEmail(input.Email)
	if email == nil {
		return UserProfile{}, apperr.New(apperr.KindInvalidArgument, "email is required")
	}
	code := strings.TrimSpace(input.Code)
	if code == "" {
		return UserProfile{}, apperr.New(apperr.KindInvalidArgument, "email code is required")
	}
	userModel, err := s.queries.GetActiveUser(ctx, input.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return UserProfile{}, apperr.New(apperr.KindUnauthorized, "user is not active")
		}
		return UserProfile{}, apperr.Wrap(apperr.KindInternal, "get email verification user", err)
	}
	if userModel.Email == nil || *userModel.Email != *email {
		return UserProfile{}, apperr.New(apperr.KindInvalidArgument, "email does not match current user")
	}
	if userModel.EmailVerifiedAt.Valid {
		return userProfileFromSQL(userModel), nil
	}
	if s.emailCodeStore == nil {
		return UserProfile{}, apperr.New(apperr.KindInternal, "email code store is not configured")
	}
	if err := s.emailCodeStore.Verify(ctx, *email, code); err != nil {
		return UserProfile{}, err
	}

	userModel, err = s.queries.UpdateUserEmailVerified(ctx, sqlc.UpdateUserEmailVerifiedParams{
		ID:    input.UserID,
		Email: email,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return UserProfile{}, apperr.New(apperr.KindNotFound, "email verification user not found")
		}
		return UserProfile{}, apperr.Wrap(apperr.KindInternal, "mark email verified", err)
	}
	return userProfileFromSQL(userModel), nil
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
		if err := s.verifyLoginMFA(ctx, userModel.ID, input.MFACode); err != nil {
			return LoginResult{}, err
		}
		userModel, err = s.queries.UpdateUserPhoneVerifiedAndLogin(ctx, userModel.ID)
		if err != nil {
			return LoginResult{}, apperr.Wrap(apperr.KindInternal, "update sms login user", err)
		}
		return s.loginResult(ctx, userModel, false, input.Request)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "find user by phone", err)
	}

	userModel, err = s.createSMSUser(ctx, input.Name, phone)
	if err != nil {
		return LoginResult{}, err
	}
	return s.loginResult(ctx, userModel, true, input.Request)
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
	return s.loginResult(ctx, userModel, true, input.Request)
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

	if err := s.verifyLoginMFA(ctx, userModel.ID, input.MFACode); err != nil {
		return LoginResult{}, err
	}
	if _, err := s.queries.ResetUserCredentialFailure(ctx, userModel.ID); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "reset password failure count", err)
	}
	userModel, err = s.queries.UpdateUserLastLogin(ctx, userModel.ID)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "update password login user", err)
	}
	return s.loginResult(ctx, userModel, false, input.Request)
}

func (s *Service) ChangePassword(ctx context.Context, input ChangePasswordInput) error {
	if input.UserID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	if strings.TrimSpace(input.CurrentPassword) == "" {
		return apperr.New(apperr.KindInvalidArgument, "current password is required")
	}
	if err := ValidatePassword(input.NewPassword, s.authCfg.Password); err != nil {
		return err
	}
	credential, err := s.queries.GetUserCredential(ctx, input.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.New(apperr.KindUnauthorized, "current password is incorrect")
		}
		return apperr.Wrap(apperr.KindInternal, "get user credential", err)
	}
	if !CheckPassword(credential.PasswordHash, input.CurrentPassword) {
		return apperr.New(apperr.KindUnauthorized, "current password is incorrect")
	}
	passwordHash, err := HashPassword(input.NewPassword)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "hash password", err)
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin password change", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `UPDATE user_credentials SET password_hash = $2, password_updated_at = now(), failed_attempts = 0, locked_until = NULL, updated_at = now(), must_change_password = false WHERE user_id = $1`, input.UserID, passwordHash); err != nil {
		return apperr.Wrap(apperr.KindInternal, "update password", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET auth_version = auth_version + 1, updated_at = now() WHERE id = $1`, input.UserID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "invalidate user tokens", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_refresh_sessions SET revoked_at = now(), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, input.UserID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "revoke user sessions", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit password change", err)
	}
	return nil
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

	createdMember, err := q.CreateWorkspaceMember(ctx, sqlc.CreateWorkspaceMemberParams{
		WorkspaceID:  workspace.ID,
		UserID:       userID,
		RoleID:       ownerRole.ID,
		ScopeType:    "workspace",
		ScopeID:      workspace.ID,
		TemplateCode: ownerRoleCode,
	})
	if err != nil {
		return mapWriteError(err, "create workspace membership")
	}
	ownerPermissions, err := q.ListPermissionCodesByTemplate(ctx, ownerRoleCode)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list owner permissions", err)
	}
	if _, err := q.AddWorkspaceMemberPermissions(ctx, sqlc.AddWorkspaceMemberPermissionsParams{
		MemberID: createdMember.ID,
		Column2:  ownerPermissions,
	}); err != nil {
		return apperr.Wrap(apperr.KindInternal, "create workspace owner permissions", err)
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

func (s *Service) Refresh(ctx context.Context, input RefreshInput) (LoginResult, error) {
	refreshToken := strings.TrimSpace(input.RefreshToken)
	if refreshToken == "" {
		return LoginResult{}, apperr.New(apperr.KindInvalidArgument, "refresh_token is required")
	}
	if s.tokens == nil {
		return LoginResult{}, apperr.New(apperr.KindInternal, "token manager is not configured")
	}
	session, err := s.queries.GetActiveRefreshSessionByHash(ctx, TokenHash(refreshToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LoginResult{}, apperr.New(apperr.KindUnauthorized, "invalid refresh token")
		}
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "get refresh session", err)
	}
	userModel, err := s.queries.GetActiveUser(ctx, session.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LoginResult{}, apperr.New(apperr.KindUnauthorized, "user is not active")
		}
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "get refresh user", err)
	}
	required, err := s.passwordChangeRequired(ctx, userModel.ID)
	if err != nil {
		return LoginResult{}, err
	}
	if required {
		if err := s.queries.RevokeRefreshSession(ctx, session.ID); err != nil {
			return LoginResult{}, apperr.Wrap(apperr.KindInternal, "revoke password change refresh session", err)
		}
		return s.initialPasswordResult(ctx, userModel, false)
	}

	authVersion, err := s.currentAuthVersion(ctx, userModel.ID)
	if err != nil {
		return LoginResult{}, err
	}
	access, err := s.tokens.GenerateWithVersion(userModel.ID, authVersion)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "generate access token", err)
	}
	nextRefresh, refreshExpiresAt, refreshExpiresIn, err := s.newRefreshToken()
	if err != nil {
		return LoginResult{}, err
	}
	if _, err := s.queries.RotateRefreshSession(ctx, sqlc.RotateRefreshSessionParams{
		ID:               session.ID,
		RefreshTokenHash: TokenHash(nextRefresh),
		UserAgent:        optionalRequestValue(input.Request.UserAgent),
		ClientIp:         optionalRequestValue(input.Request.ClientIP),
		ExpiresAt:        pgTimestamp(refreshExpiresAt),
	}); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "rotate refresh session", err)
	}
	return loginResultFromTokens(userModel, access, nextRefresh, refreshExpiresIn, false), nil
}

func (s *Service) Logout(ctx context.Context, input LogoutInput) error {
	refreshToken := strings.TrimSpace(input.RefreshToken)
	accessToken := strings.TrimSpace(input.AccessToken)
	if refreshToken == "" && accessToken == "" {
		return apperr.New(apperr.KindInvalidArgument, "access token or refresh_token is required")
	}
	if refreshToken != "" {
		session, err := s.queries.GetActiveRefreshSessionByHash(ctx, TokenHash(refreshToken))
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				return apperr.Wrap(apperr.KindInternal, "get refresh session", err)
			}
		} else if input.UserID != uuid.Nil && session.UserID != input.UserID {
			return apperr.New(apperr.KindPermissionDenied, "refresh token does not belong to actor")
		} else if err := s.queries.RevokeRefreshSession(ctx, session.ID); err != nil {
			return apperr.Wrap(apperr.KindInternal, "revoke refresh session", err)
		}
	}
	if accessToken == "" {
		return nil
	}
	if s.tokens == nil {
		return apperr.New(apperr.KindInternal, "token manager is not configured")
	}
	info, err := s.tokens.ParseInfo(accessToken)
	if err != nil {
		return apperr.New(apperr.KindUnauthorized, "invalid bearer token")
	}
	if input.UserID != uuid.Nil && info.UserID != input.UserID {
		return apperr.New(apperr.KindPermissionDenied, "access token does not belong to actor")
	}
	if !info.ExpiresAt.After(s.now()) {
		return nil
	}
	if err := s.queries.BlacklistAccessToken(ctx, sqlc.BlacklistAccessTokenParams{
		TokenHash: TokenHash(accessToken),
		UserID:    info.UserID,
		ExpiresAt: pgTimestamp(info.ExpiresAt),
	}); err != nil {
		return apperr.Wrap(apperr.KindInternal, "blacklist access token", err)
	}
	_ = s.queries.DeleteExpiredAuthTokens(ctx)
	return nil
}

func (s *Service) ListSessions(ctx context.Context, input ListSessionsInput) ([]Session, error) {
	if input.UserID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	rows, err := s.queries.ListActiveRefreshSessionsByUser(ctx, input.UserID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list auth sessions", err)
	}
	items := make([]Session, 0, len(rows))
	for _, row := range rows {
		items = append(items, sessionFromSQL(row))
	}
	return items, nil
}

func (s *Service) RevokeSession(ctx context.Context, input RevokeSessionInput) error {
	if input.UserID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	if input.SessionID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "session id is required")
	}
	rows, err := s.queries.RevokeRefreshSessionForUser(ctx, sqlc.RevokeRefreshSessionForUserParams{
		ID:     input.SessionID,
		UserID: input.UserID,
	})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "revoke auth session", err)
	}
	if rows == 0 {
		return apperr.New(apperr.KindNotFound, "auth session not found")
	}
	return nil
}

func (s *Service) IsAccessTokenRevoked(ctx context.Context, rawToken string) (bool, error) {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return false, nil
	}
	revoked, err := s.queries.IsAccessTokenBlacklisted(ctx, TokenHash(rawToken))
	if err != nil {
		return false, apperr.Wrap(apperr.KindInternal, "check access token blacklist", err)
	}
	return revoked, nil
}

func sessionFromSQL(model sqlc.AuthRefreshSession) Session {
	return Session{
		ID:         model.ID,
		UserAgent:  model.UserAgent,
		ClientIP:   model.ClientIp,
		ExpiresAt:  pgTimeValue(model.ExpiresAt),
		LastUsedAt: pgTimePtr(model.LastUsedAt),
		CreatedAt:  pgTimeValue(model.CreatedAt),
	}
}

func (s *Service) loginResult(ctx context.Context, userModel sqlc.User, created bool, request RequestInfo) (LoginResult, error) {
	if s.tokens == nil {
		return LoginResult{}, apperr.New(apperr.KindInternal, "token manager is not configured")
	}
	required, err := s.passwordChangeRequired(ctx, userModel.ID)
	if err != nil {
		return LoginResult{}, err
	}
	if required {
		return s.initialPasswordResult(ctx, userModel, created)
	}
	authVersion, err := s.currentAuthVersion(ctx, userModel.ID)
	if err != nil {
		return LoginResult{}, err
	}
	token, err := s.tokens.GenerateWithVersion(userModel.ID, authVersion)
	if err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "generate access token", err)
	}
	refreshToken, refreshExpiresAt, refreshExpiresIn, err := s.newRefreshToken()
	if err != nil {
		return LoginResult{}, err
	}
	if _, err := s.queries.CreateRefreshSession(ctx, sqlc.CreateRefreshSessionParams{
		UserID:           userModel.ID,
		RefreshTokenHash: TokenHash(refreshToken),
		UserAgent:        optionalRequestValue(request.UserAgent),
		ClientIp:         optionalRequestValue(request.ClientIP),
		ExpiresAt:        pgTimestamp(refreshExpiresAt),
	}); err != nil {
		return LoginResult{}, apperr.Wrap(apperr.KindInternal, "create refresh session", err)
	}
	return loginResultFromTokens(userModel, token, refreshToken, refreshExpiresIn, created), nil
}

func (s *Service) currentAuthVersion(ctx context.Context, userID uuid.UUID) (int, error) {
	var version int
	if err := s.db.QueryRow(ctx, `SELECT auth_version FROM users WHERE id = $1`, userID).Scan(&version); err != nil {
		return 0, apperr.Wrap(apperr.KindInternal, "get user auth version", err)
	}
	return version, nil
}

func (s *Service) newRefreshToken() (string, time.Time, int64, error) {
	token, err := NewRefreshToken()
	if err != nil {
		return "", time.Time{}, 0, apperr.Wrap(apperr.KindInternal, "generate refresh token", err)
	}
	ttl := time.Duration(s.refreshTokenTTLDays()) * 24 * time.Hour
	expiresAt := s.now().Add(ttl).UTC()
	return token, expiresAt, int64(ttl.Seconds()), nil
}

func (s *Service) refreshTokenTTLDays() int {
	if s.authCfg.RefreshTokenTTLDays > 0 {
		return s.authCfg.RefreshTokenTTLDays
	}
	return 30
}

func loginResultFromTokens(userModel sqlc.User, access TokenPair, refreshToken string, refreshExpiresIn int64, created bool) LoginResult {
	return LoginResult{
		AccessToken:      access.AccessToken,
		RefreshToken:     refreshToken,
		TokenType:        access.TokenType,
		ExpiresIn:        access.ExpiresIn,
		RefreshExpiresIn: refreshExpiresIn,
		User:             userProfileFromSQL(userModel),
		Created:          created,
	}
}

func optionalRequestValue(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func pgTimestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value.UTC(), Valid: true}
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
		return "用户的工作区"
	}
	return strings.TrimSpace(name) + "的工作区"
}

func pgTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func pgTimeValue(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
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
