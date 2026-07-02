package user

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
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/db/sqlc"
)

const ownerRoleCode = "owner"

type Service struct {
	db      *pgxpool.Pool
	queries *sqlc.Queries
}

type User struct {
	ID              uuid.UUID  `json:"id"`
	Name            string     `json:"name"`
	Phone           *string    `json:"phone,omitempty"`
	Email           *string    `json:"email,omitempty"`
	Status          string     `json:"status"`
	IsSystemAdmin   bool       `json:"is_system_admin"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	PhoneVerifiedAt *time.Time `json:"phone_verified_at,omitempty"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	LastLoginAt     *time.Time `json:"last_login_at,omitempty"`
}

type Workspace struct {
	ID               uuid.UUID `json:"id"`
	Type             string    `json:"type"`
	OrganizationType *string   `json:"organization_type,omitempty"`
	Name             string    `json:"name"`
	OwnerUserID      uuid.UUID `json:"owner_user_id"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type Membership struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	UserID      uuid.UUID `json:"user_id"`
	RoleID      uuid.UUID `json:"role_id"`
	RoleCode    string    `json:"role_code"`
	RoleName    string    `json:"role_name"`
	Status      string    `json:"status"`
	JoinedAt    time.Time `json:"joined_at"`
}

type RegisterInput struct {
	Name  string
	Phone string
	Email string
}

type RegisterResult struct {
	User       User       `json:"user"`
	Workspace  Workspace  `json:"workspace"`
	Membership Membership `json:"membership"`
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		db:      db,
		queries: sqlc.New(db),
	}
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (RegisterResult, error) {
	name := strings.TrimSpace(input.Name)
	phone := optionalString(input.Phone)
	email := optionalString(input.Email)

	if phone == nil && email == nil {
		return RegisterResult{}, apperr.New(apperr.KindInvalidArgument, "phone or email is required")
	}
	if name == "" {
		name = "User"
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return RegisterResult{}, apperr.Wrap(apperr.KindInternal, "begin registration transaction", err)
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
		return RegisterResult{}, mapCreateUserError(err)
	}

	ownerRole, err := q.GetSystemRoleByCode(ctx, ownerRoleCode)
	if err != nil {
		return RegisterResult{}, mapInternalOrNotFound(err, "owner role is not seeded")
	}

	createdWorkspace, err := q.CreatePersonalWorkspace(ctx, sqlc.CreatePersonalWorkspaceParams{
		Name:        personalWorkspaceName(name),
		OwnerUserID: createdUser.ID,
	})
	if err != nil {
		return RegisterResult{}, mapWriteError(err, "create personal workspace")
	}

	createdMember, err := q.CreateWorkspaceMember(ctx, sqlc.CreateWorkspaceMemberParams{
		WorkspaceID: createdWorkspace.ID,
		UserID:      createdUser.ID,
		RoleID:      ownerRole.ID,
	})
	if err != nil {
		return RegisterResult{}, mapWriteError(err, "create workspace membership")
	}

	if err := tx.Commit(ctx); err != nil {
		return RegisterResult{}, apperr.Wrap(apperr.KindInternal, "commit registration transaction", err)
	}
	committed = true

	return RegisterResult{
		User:       userFromSQL(createdUser),
		Workspace:  workspaceFromSQL(createdWorkspace),
		Membership: membershipFromSQL(createdMember, ownerRole.Code, ownerRole.Name),
	}, nil
}

func (s *Service) GetActiveUser(ctx context.Context, id uuid.UUID) (User, error) {
	model, err := s.queries.GetActiveUser(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, apperr.New(apperr.KindNotFound, "user not found")
		}
		return User{}, apperr.Wrap(apperr.KindInternal, "get active user", err)
	}
	return userFromSQL(model), nil
}

func (s *Service) LookupActor(ctx context.Context, id uuid.UUID) (auth.Actor, error) {
	model, err := s.GetActiveUser(ctx, id)
	if err != nil {
		return auth.Actor{}, err
	}
	return auth.Actor{
		UserID:          model.ID,
		Name:            model.Name,
		Phone:           model.Phone,
		Email:           model.Email,
		Status:          model.Status,
		IsSystemAdmin:   model.IsSystemAdmin,
		PhoneVerifiedAt: model.PhoneVerifiedAt,
		EmailVerifiedAt: model.EmailVerifiedAt,
	}, nil
}

func optionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func personalWorkspaceName(name string) string {
	if strings.TrimSpace(name) == "" {
		return "Personal Workspace"
	}
	return strings.TrimSpace(name) + " Personal Workspace"
}

func userFromSQL(model sqlc.User) User {
	return User{
		ID:              model.ID,
		Name:            model.Name,
		Phone:           model.Phone,
		Email:           model.Email,
		Status:          model.Status,
		IsSystemAdmin:   model.IsSystemAdmin,
		CreatedAt:       pgTime(model.CreatedAt),
		UpdatedAt:       pgTime(model.UpdatedAt),
		PhoneVerifiedAt: pgTimePtr(model.PhoneVerifiedAt),
		EmailVerifiedAt: pgTimePtr(model.EmailVerifiedAt),
		LastLoginAt:     pgTimePtr(model.LastLoginAt),
	}
}

func workspaceFromSQL(model sqlc.Workspace) Workspace {
	return Workspace{
		ID:               model.ID,
		Type:             model.Type,
		OrganizationType: model.OrganizationType,
		Name:             model.Name,
		OwnerUserID:      model.OwnerUserID,
		Status:           model.Status,
		CreatedAt:        pgTime(model.CreatedAt),
		UpdatedAt:        pgTime(model.UpdatedAt),
	}
}

func membershipFromSQL(model sqlc.WorkspaceMember, roleCode string, roleName string) Membership {
	return Membership{
		ID:          model.ID,
		WorkspaceID: model.WorkspaceID,
		UserID:      model.UserID,
		RoleID:      model.RoleID,
		RoleCode:    roleCode,
		RoleName:    roleName,
		Status:      model.Status,
		JoinedAt:    pgTime(model.JoinedAt),
	}
}

func pgTime(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
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

func mapWriteError(err error, message string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return apperr.Wrap(apperr.KindConflict, "resource already exists", err)
		case "23514", "23503":
			return apperr.Wrap(apperr.KindInvalidArgument, message, err)
		}
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}

func mapInternalOrNotFound(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindInternal, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
