package member

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

type UserSummary struct {
	ID     uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Phone  *string   `json:"phone,omitempty"`
	Email  *string   `json:"email,omitempty"`
	Status string    `json:"status"`
}

type RoleSummary struct {
	ID   uuid.UUID `json:"id"`
	Code string    `json:"code"`
	Name string    `json:"name"`
}

type WorkspaceMember struct {
	ID          uuid.UUID   `json:"id"`
	WorkspaceID uuid.UUID   `json:"workspace_id"`
	Status      string      `json:"status"`
	JoinedAt    time.Time   `json:"joined_at"`
	User        UserSummary `json:"user"`
	Role        RoleSummary `json:"role"`
}

type AddInput struct {
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Email       string
	Phone       string
	RoleCode    string
}

type UpdateRoleInput struct {
	WorkspaceID uuid.UUID
	MemberID    uuid.UUID
	RoleCode    string
}

type RemoveInput struct {
	WorkspaceID uuid.UUID
	MemberID    uuid.UUID
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		db:      db,
		queries: sqlc.New(db),
	}
}

func (s *Service) List(ctx context.Context, workspaceID uuid.UUID) ([]WorkspaceMember, error) {
	if workspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}

	rows, err := s.queries.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list workspace members", err)
	}

	items := make([]WorkspaceMember, 0, len(rows))
	for _, row := range rows {
		items = append(items, memberFromListRow(row))
	}
	return items, nil
}

func (s *Service) Add(ctx context.Context, input AddInput) (WorkspaceMember, error) {
	roleCode := strings.TrimSpace(input.RoleCode)
	if input.WorkspaceID == uuid.Nil {
		return WorkspaceMember{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if !isInternalMemberRole(roleCode) {
		return WorkspaceMember{}, apperr.New(apperr.KindInvalidArgument, "invalid role_code for workspace member")
	}
	if err := validateTargetSelector(input); err != nil {
		return WorkspaceMember{}, err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return WorkspaceMember{}, apperr.Wrap(apperr.KindInternal, "begin add member transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)

	targetUser, err := resolveTargetUser(ctx, q, input)
	if err != nil {
		return WorkspaceMember{}, err
	}

	role, err := q.GetSystemRoleByCode(ctx, roleCode)
	if err != nil {
		return WorkspaceMember{}, mapNotFoundOrInternal(err, "role not found")
	}

	existing, err := q.GetWorkspaceMember(ctx, sqlc.GetWorkspaceMemberParams{
		WorkspaceID: input.WorkspaceID,
		UserID:      targetUser.ID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceMember{}, apperr.Wrap(apperr.KindInternal, "get existing workspace member", err)
	}
	if err == nil && existing.Status == "active" {
		return WorkspaceMember{}, apperr.New(apperr.KindConflict, "user is already an active workspace member")
	}

	if errors.Is(err, pgx.ErrNoRows) {
		_, err = q.CreateWorkspaceMember(ctx, sqlc.CreateWorkspaceMemberParams{
			WorkspaceID: input.WorkspaceID,
			UserID:      targetUser.ID,
			RoleID:      role.ID,
		})
		if err != nil {
			return WorkspaceMember{}, mapWriteError(err, "create workspace member")
		}
	} else {
		_, err = q.UpdateWorkspaceMemberRoleStatusByUser(ctx, sqlc.UpdateWorkspaceMemberRoleStatusByUserParams{
			WorkspaceID: input.WorkspaceID,
			UserID:      targetUser.ID,
			RoleID:      role.ID,
			Status:      "active",
		})
		if err != nil {
			return WorkspaceMember{}, mapWriteError(err, "restore workspace member")
		}
	}

	detail, err := q.GetWorkspaceMember(ctx, sqlc.GetWorkspaceMemberParams{
		WorkspaceID: input.WorkspaceID,
		UserID:      targetUser.ID,
	})
	if err != nil {
		return WorkspaceMember{}, mapNotFoundOrInternal(err, "workspace member not found")
	}

	memberDetail, err := q.GetWorkspaceMemberDetail(ctx, sqlc.GetWorkspaceMemberDetailParams{
		WorkspaceID: input.WorkspaceID,
		ID:          detail.ID,
	})
	if err != nil {
		return WorkspaceMember{}, mapNotFoundOrInternal(err, "workspace member not found")
	}

	if err := tx.Commit(ctx); err != nil {
		return WorkspaceMember{}, apperr.Wrap(apperr.KindInternal, "commit add member transaction", err)
	}
	committed = true

	return memberFromDetailRow(memberDetail), nil
}

func (s *Service) UpdateRole(ctx context.Context, input UpdateRoleInput) (WorkspaceMember, error) {
	roleCode := strings.TrimSpace(input.RoleCode)
	if input.WorkspaceID == uuid.Nil {
		return WorkspaceMember{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.MemberID == uuid.Nil {
		return WorkspaceMember{}, apperr.New(apperr.KindInvalidArgument, "member id is required")
	}
	if !isInternalMemberRole(roleCode) {
		return WorkspaceMember{}, apperr.New(apperr.KindInvalidArgument, "invalid role_code for workspace member")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return WorkspaceMember{}, apperr.Wrap(apperr.KindInternal, "begin update member transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)

	current, err := q.GetWorkspaceMemberDetail(ctx, sqlc.GetWorkspaceMemberDetailParams{
		WorkspaceID: input.WorkspaceID,
		ID:          input.MemberID,
	})
	if err != nil {
		return WorkspaceMember{}, mapNotFoundOrInternal(err, "workspace member not found")
	}
	if current.Status == "removed" {
		return WorkspaceMember{}, apperr.New(apperr.KindNotFound, "workspace member not found")
	}

	if current.RoleCode == ownerRoleCode && roleCode != ownerRoleCode {
		if err := ensureNotLastOwner(ctx, q, input.WorkspaceID); err != nil {
			return WorkspaceMember{}, err
		}
	}

	role, err := q.GetSystemRoleByCode(ctx, roleCode)
	if err != nil {
		return WorkspaceMember{}, mapNotFoundOrInternal(err, "role not found")
	}

	_, err = q.UpdateWorkspaceMemberRole(ctx, sqlc.UpdateWorkspaceMemberRoleParams{
		WorkspaceID: input.WorkspaceID,
		ID:          input.MemberID,
		RoleID:      role.ID,
	})
	if err != nil {
		return WorkspaceMember{}, mapWriteError(err, "update workspace member role")
	}

	updated, err := q.GetWorkspaceMemberDetail(ctx, sqlc.GetWorkspaceMemberDetailParams{
		WorkspaceID: input.WorkspaceID,
		ID:          input.MemberID,
	})
	if err != nil {
		return WorkspaceMember{}, mapNotFoundOrInternal(err, "workspace member not found")
	}

	if err := tx.Commit(ctx); err != nil {
		return WorkspaceMember{}, apperr.Wrap(apperr.KindInternal, "commit update member transaction", err)
	}
	committed = true

	return memberFromDetailRow(updated), nil
}

func (s *Service) Remove(ctx context.Context, input RemoveInput) error {
	if input.WorkspaceID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.MemberID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "member id is required")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin remove member transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)

	current, err := q.GetWorkspaceMemberDetail(ctx, sqlc.GetWorkspaceMemberDetailParams{
		WorkspaceID: input.WorkspaceID,
		ID:          input.MemberID,
	})
	if err != nil {
		return mapNotFoundOrInternal(err, "workspace member not found")
	}
	if current.Status == "removed" {
		return apperr.New(apperr.KindNotFound, "workspace member not found")
	}

	if current.RoleCode == ownerRoleCode {
		if err := ensureNotLastOwner(ctx, q, input.WorkspaceID); err != nil {
			return err
		}
	}

	if _, err := q.RemoveWorkspaceMember(ctx, sqlc.RemoveWorkspaceMemberParams{
		WorkspaceID: input.WorkspaceID,
		ID:          input.MemberID,
	}); err != nil {
		return mapWriteError(err, "remove workspace member")
	}

	if err := tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit remove member transaction", err)
	}
	committed = true

	return nil
}

func resolveTargetUser(ctx context.Context, q *sqlc.Queries, input AddInput) (sqlc.User, error) {
	email := strings.TrimSpace(input.Email)
	phone := strings.TrimSpace(input.Phone)

	if err := validateTargetSelector(input); err != nil {
		return sqlc.User{}, err
	}

	switch {
	case input.UserID != uuid.Nil:
		user, err := q.GetActiveUser(ctx, input.UserID)
		if err != nil {
			return sqlc.User{}, mapNotFoundOrInternal(err, "target user not found")
		}
		return user, nil
	case email != "":
		user, err := q.FindActiveUserByEmail(ctx, &email)
		if err != nil {
			return sqlc.User{}, mapNotFoundOrInternal(err, "target user not found")
		}
		return user, nil
	default:
		user, err := q.FindActiveUserByPhone(ctx, &phone)
		if err != nil {
			return sqlc.User{}, mapNotFoundOrInternal(err, "target user not found")
		}
		return user, nil
	}
}

func validateTargetSelector(input AddInput) error {
	email := strings.TrimSpace(input.Email)
	phone := strings.TrimSpace(input.Phone)

	selectors := 0
	if input.UserID != uuid.Nil {
		selectors++
	}
	if email != "" {
		selectors++
	}
	if phone != "" {
		selectors++
	}
	if selectors != 1 {
		return apperr.New(apperr.KindInvalidArgument, "exactly one of user_id, email, or phone is required")
	}
	return nil
}

func ensureNotLastOwner(ctx context.Context, q *sqlc.Queries, workspaceID uuid.UUID) error {
	count, err := q.CountActiveWorkspaceOwners(ctx, workspaceID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "count workspace owners", err)
	}
	if count <= 1 {
		return apperr.New(apperr.KindConflict, "workspace must keep at least one active owner")
	}
	return nil
}

func isInternalMemberRole(roleCode string) bool {
	switch roleCode {
	case "owner", "admin", "project_manager", "site_operator", "data_manager", "researcher", "viewer":
		return true
	default:
		return false
	}
}

func memberFromListRow(row sqlc.ListWorkspaceMembersRow) WorkspaceMember {
	return WorkspaceMember{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		Status:      row.Status,
		JoinedAt:    pgTime(row.JoinedAt),
		User: UserSummary{
			ID:     row.UserID,
			Name:   row.UserName,
			Phone:  row.UserPhone,
			Email:  row.UserEmail,
			Status: row.UserStatus,
		},
		Role: RoleSummary{
			ID:   row.RoleID,
			Code: row.RoleCode,
			Name: row.RoleName,
		},
	}
}

func memberFromDetailRow(row sqlc.GetWorkspaceMemberDetailRow) WorkspaceMember {
	return WorkspaceMember{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		Status:      row.Status,
		JoinedAt:    pgTime(row.JoinedAt),
		User: UserSummary{
			ID:     row.UserID,
			Name:   row.UserName,
			Phone:  row.UserPhone,
			Email:  row.UserEmail,
			Status: row.UserStatus,
		},
		Role: RoleSummary{
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
		case "23503", "23514":
			return apperr.Wrap(apperr.KindInvalidArgument, message, err)
		}
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}

func mapNotFoundOrInternal(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindNotFound, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
