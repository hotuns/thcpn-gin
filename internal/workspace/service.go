package workspace

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
	"thcpn-gin/internal/db/sqlc"
)

const ownerRoleCode = "owner"

type Service struct {
	db      *pgxpool.Pool
	queries *sqlc.Queries
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

type Role struct {
	ID   uuid.UUID `json:"id"`
	Code string    `json:"code"`
	Name string    `json:"name"`
}

type Membership struct {
	ID       uuid.UUID `json:"id"`
	Status   string    `json:"status"`
	JoinedAt time.Time `json:"joined_at"`
	Role     Role      `json:"role"`
}

type WorkspaceWithMembership struct {
	Workspace  Workspace  `json:"workspace"`
	Membership Membership `json:"membership"`
}

type CreateOrganizationInput struct {
	Name             string
	OrganizationType string
	OwnerUserID      uuid.UUID
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		db:      db,
		queries: sqlc.New(db),
	}
}

func (s *Service) CreateOrganization(ctx context.Context, input CreateOrganizationInput) (WorkspaceWithMembership, error) {
	name := strings.TrimSpace(input.Name)
	orgType := strings.TrimSpace(input.OrganizationType)

	if input.OwnerUserID == uuid.Nil {
		return WorkspaceWithMembership{}, apperr.New(apperr.KindInvalidArgument, "owner user id is required")
	}
	if name == "" {
		return WorkspaceWithMembership{}, apperr.New(apperr.KindInvalidArgument, "workspace name is required")
	}
	if !isValidOrganizationType(orgType) {
		return WorkspaceWithMembership{}, apperr.New(apperr.KindInvalidArgument, "invalid organization_type")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return WorkspaceWithMembership{}, apperr.Wrap(apperr.KindInternal, "begin workspace transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	ownerRole, err := q.GetSystemRoleByCode(ctx, ownerRoleCode)
	if err != nil {
		return WorkspaceWithMembership{}, mapInternalOrNotFound(err, "owner role is not seeded")
	}

	createdWorkspace, err := q.CreateOrganizationWorkspace(ctx, sqlc.CreateOrganizationWorkspaceParams{
		OrganizationType: &orgType,
		Name:             name,
		OwnerUserID:      input.OwnerUserID,
	})
	if err != nil {
		return WorkspaceWithMembership{}, mapWriteError(err, "create organization workspace")
	}

	createdMember, err := q.CreateWorkspaceMember(ctx, sqlc.CreateWorkspaceMemberParams{
		WorkspaceID: createdWorkspace.ID,
		UserID:      input.OwnerUserID,
		RoleID:      ownerRole.ID,
	})
	if err != nil {
		return WorkspaceWithMembership{}, mapWriteError(err, "create workspace membership")
	}

	if err := tx.Commit(ctx); err != nil {
		return WorkspaceWithMembership{}, apperr.Wrap(apperr.KindInternal, "commit workspace transaction", err)
	}
	committed = true

	return WorkspaceWithMembership{
		Workspace: workspaceFromSQL(createdWorkspace),
		Membership: membershipFromSQL(sqlc.ListWorkspacesForUserRow{
			MembershipID:       createdMember.ID,
			MembershipStatus:   createdMember.Status,
			MembershipJoinedAt: createdMember.JoinedAt,
			RoleID:             ownerRole.ID,
			RoleCode:           ownerRole.Code,
			RoleName:           ownerRole.Name,
		}),
	}, nil
}

func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID) ([]WorkspaceWithMembership, error) {
	if userID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}

	rows, err := s.queries.ListWorkspacesForUser(ctx, userID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list workspaces", err)
	}

	items := make([]WorkspaceWithMembership, 0, len(rows))
	for _, row := range rows {
		items = append(items, WorkspaceWithMembership{
			Workspace:  workspaceFromListRow(row),
			Membership: membershipFromSQL(row),
		})
	}
	return items, nil
}

func (s *Service) ListAll(ctx context.Context) ([]Workspace, error) {
	rows, err := s.queries.ListWorkspaces(ctx)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list all workspaces", err)
	}
	items := make([]Workspace, 0, len(rows))
	for _, row := range rows {
		items = append(items, workspaceFromSQL(row))
	}
	return items, nil
}

func isValidOrganizationType(value string) bool {
	switch value {
	case "lab", "institution", "company", "government", "service_provider", "other":
		return true
	default:
		return false
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

func workspaceFromListRow(row sqlc.ListWorkspacesForUserRow) Workspace {
	return Workspace{
		ID:               row.ID,
		Type:             row.Type,
		OrganizationType: row.OrganizationType,
		Name:             row.Name,
		OwnerUserID:      row.OwnerUserID,
		Status:           row.Status,
		CreatedAt:        pgTime(row.CreatedAt),
		UpdatedAt:        pgTime(row.UpdatedAt),
	}
}

func membershipFromSQL(row sqlc.ListWorkspacesForUserRow) Membership {
	return Membership{
		ID:       row.MembershipID,
		Status:   row.MembershipStatus,
		JoinedAt: pgTime(row.MembershipJoinedAt),
		Role: Role{
			ID:   row.RoleID,
			Code: row.RoleCode,
			Name: row.RoleName,
		},
	}
}

func pgTime(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
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
