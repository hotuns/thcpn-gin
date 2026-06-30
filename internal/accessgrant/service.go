package accessgrant

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

const serviceEngineerRoleCode = "service_engineer"

type Service struct {
	db      *pgxpool.Pool
	queries *sqlc.Queries
}

type RoleSummary struct {
	ID   uuid.UUID `json:"id"`
	Code string    `json:"code"`
	Name string    `json:"name"`
}

type SubjectSummary struct {
	Type  string    `json:"type"`
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name,omitempty"`
	Phone *string   `json:"phone,omitempty"`
	Email *string   `json:"email,omitempty"`
}

type AccessGrant struct {
	ID             uuid.UUID      `json:"id"`
	WorkspaceID    uuid.UUID      `json:"workspace_id"`
	Subject        SubjectSummary `json:"subject"`
	Role           RoleSummary    `json:"role"`
	ScopeType      string         `json:"scope_type"`
	ScopeID        uuid.UUID      `json:"scope_id"`
	ExpiresAt      *time.Time     `json:"expires_at,omitempty"`
	AllowReshare   bool           `json:"allow_reshare"`
	AllowAPIAccess bool           `json:"allow_api_access"`
	CreatedBy      uuid.UUID      `json:"created_by"`
	Status         string         `json:"status"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type Invitation struct {
	ID           uuid.UUID   `json:"id"`
	WorkspaceID  uuid.UUID   `json:"workspace_id"`
	InviteeEmail *string     `json:"invitee_email,omitempty"`
	InviteePhone *string     `json:"invitee_phone,omitempty"`
	Role         RoleSummary `json:"role"`
	ScopeType    string      `json:"scope_type"`
	ScopeID      uuid.UUID   `json:"scope_id"`
	ExpiresAt    *time.Time  `json:"expires_at,omitempty"`
	InvitedBy    uuid.UUID   `json:"invited_by"`
	Status       string      `json:"status"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`
}

type CreateGrantInput struct {
	SubjectUserID  uuid.UUID
	Email          string
	Phone          string
	RoleCode       string
	ScopeType      string
	ScopeID        uuid.UUID
	ExpiresAt      *time.Time
	AllowReshare   bool
	AllowAPIAccess bool
	ActorUserID    uuid.UUID
}

type CreateInvitationInput struct {
	Email       string
	Phone       string
	RoleCode    string
	ScopeType   string
	ScopeID     uuid.UUID
	ExpiresAt   *time.Time
	ActorUserID uuid.UUID
}

type AcceptInvitationInput struct {
	InvitationID uuid.UUID
	ActorUserID  uuid.UUID
	ActorEmail   *string
	ActorPhone   *string
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		db:      db,
		queries: sqlc.New(db),
	}
}

func (s *Service) CreateGrant(ctx context.Context, input CreateGrantInput) (AccessGrant, error) {
	if input.ActorUserID == uuid.Nil {
		return AccessGrant{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if err := validateTargetSelector(input.SubjectUserID, input.Email, input.Phone); err != nil {
		return AccessGrant{}, err
	}
	if input.ScopeID == uuid.Nil {
		return AccessGrant{}, apperr.New(apperr.KindInvalidArgument, "scope id is required")
	}
	if err := validateExpiresAt(input.ExpiresAt); err != nil {
		return AccessGrant{}, err
	}

	subject, err := s.resolveSubject(ctx, input)
	if err != nil {
		return AccessGrant{}, err
	}
	scope, err := s.resolveScope(ctx, input.ScopeType, input.ScopeID)
	if err != nil {
		return AccessGrant{}, err
	}
	role, err := s.resolveRole(ctx, input.RoleCode, input.ScopeType, input.ExpiresAt)
	if err != nil {
		return AccessGrant{}, err
	}

	created, err := s.queries.CreateAccessGrant(ctx, sqlc.CreateAccessGrantParams{
		WorkspaceID:    scope.workspaceID,
		SubjectID:      subject.ID,
		RoleID:         role.ID,
		ScopeType:      scope.scopeType,
		ScopeID:        scope.scopeID,
		ExpiresAt:      pgTime(input.ExpiresAt),
		AllowReshare:   input.AllowReshare,
		AllowApiAccess: input.AllowAPIAccess,
		CreatedBy:      input.ActorUserID,
	})
	if err != nil {
		return AccessGrant{}, mapWriteError(err, "create access grant")
	}

	return grantFromSQL(created, role, subject), nil
}

func (s *Service) GetGrant(ctx context.Context, grantID uuid.UUID) (AccessGrant, error) {
	if grantID == uuid.Nil {
		return AccessGrant{}, apperr.New(apperr.KindInvalidArgument, "access grant id is required")
	}

	row, err := s.queries.GetAccessGrant(ctx, grantID)
	if err != nil {
		return AccessGrant{}, mapNotFoundOrInternal(err, "access grant not found")
	}

	return grantFromGetRow(row), nil
}

func (s *Service) ListGrantsByWorkspace(ctx context.Context, workspaceID uuid.UUID) ([]AccessGrant, error) {
	if workspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}

	rows, err := s.queries.ListAccessGrantsByWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list access grants", err)
	}

	items := make([]AccessGrant, 0, len(rows))
	for _, row := range rows {
		items = append(items, grantFromWorkspaceRow(row))
	}
	return items, nil
}

func (s *Service) ListGrantsForUser(ctx context.Context, userID uuid.UUID) ([]AccessGrant, error) {
	if userID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}

	rows, err := s.queries.ListAccessGrantsForUser(ctx, userID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list shared resources", err)
	}

	items := make([]AccessGrant, 0, len(rows))
	for _, row := range rows {
		items = append(items, grantFromUserRow(row))
	}
	return items, nil
}

func (s *Service) RevokeGrant(ctx context.Context, grantID uuid.UUID) (AccessGrant, error) {
	if grantID == uuid.Nil {
		return AccessGrant{}, apperr.New(apperr.KindInvalidArgument, "access grant id is required")
	}

	revoked, err := s.queries.RevokeAccessGrant(ctx, grantID)
	if err != nil {
		return AccessGrant{}, mapNotFoundOrInternal(err, "active access grant not found")
	}
	row, err := s.queries.GetAccessGrant(ctx, revoked.ID)
	if err != nil {
		return AccessGrant{}, mapNotFoundOrInternal(err, "access grant not found")
	}
	return grantFromGetRow(row), nil
}

func (s *Service) CreateInvitation(ctx context.Context, input CreateInvitationInput) (Invitation, error) {
	if input.ActorUserID == uuid.Nil {
		return Invitation{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	email := nullableTrimmedString(input.Email)
	phone := nullableTrimmedString(input.Phone)
	if (email == nil && phone == nil) || (email != nil && phone != nil) {
		return Invitation{}, apperr.New(apperr.KindInvalidArgument, "exactly one of email or phone is required")
	}
	if input.ScopeID == uuid.Nil {
		return Invitation{}, apperr.New(apperr.KindInvalidArgument, "scope id is required")
	}
	if err := validateExpiresAt(input.ExpiresAt); err != nil {
		return Invitation{}, err
	}

	scope, err := s.resolveScope(ctx, input.ScopeType, input.ScopeID)
	if err != nil {
		return Invitation{}, err
	}
	role, err := s.resolveRole(ctx, input.RoleCode, input.ScopeType, input.ExpiresAt)
	if err != nil {
		return Invitation{}, err
	}

	created, err := s.queries.CreateInvitation(ctx, sqlc.CreateInvitationParams{
		WorkspaceID:  scope.workspaceID,
		InviteeEmail: email,
		InviteePhone: phone,
		RoleID:       role.ID,
		ScopeType:    scope.scopeType,
		ScopeID:      scope.scopeID,
		ExpiresAt:    pgTime(input.ExpiresAt),
		InvitedBy:    input.ActorUserID,
	})
	if err != nil {
		return Invitation{}, mapWriteError(err, "create invitation")
	}

	return invitationFromSQL(created, role), nil
}

func (s *Service) GetInvitation(ctx context.Context, invitationID uuid.UUID) (Invitation, error) {
	if invitationID == uuid.Nil {
		return Invitation{}, apperr.New(apperr.KindInvalidArgument, "invitation id is required")
	}

	row, err := s.queries.GetInvitation(ctx, invitationID)
	if err != nil {
		return Invitation{}, mapNotFoundOrInternal(err, "invitation not found")
	}
	return invitationFromGetRow(row), nil
}

func (s *Service) ListInvitationsByWorkspace(ctx context.Context, workspaceID uuid.UUID) ([]Invitation, error) {
	if workspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}

	rows, err := s.queries.ListInvitationsByWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list invitations", err)
	}

	items := make([]Invitation, 0, len(rows))
	for _, row := range rows {
		items = append(items, invitationFromWorkspaceRow(row))
	}
	return items, nil
}

func (s *Service) ListPendingInvitationsForActor(ctx context.Context, email *string, phone *string) ([]Invitation, error) {
	emailValue := ""
	phoneValue := ""
	if email != nil {
		emailValue = strings.TrimSpace(*email)
	}
	if phone != nil {
		phoneValue = strings.TrimSpace(*phone)
	}
	if emailValue == "" && phoneValue == "" {
		return []Invitation{}, nil
	}

	rows, err := s.queries.ListPendingInvitationsForIdentity(ctx, sqlc.ListPendingInvitationsForIdentityParams{
		InviteeEmail: emailValue,
		InviteePhone: phoneValue,
	})
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list pending invitations", err)
	}

	items := make([]Invitation, 0, len(rows))
	for _, row := range rows {
		items = append(items, invitationFromIdentityRow(row))
	}
	return items, nil
}

func (s *Service) AcceptInvitation(ctx context.Context, input AcceptInvitationInput) (AccessGrant, error) {
	if input.InvitationID == uuid.Nil {
		return AccessGrant{}, apperr.New(apperr.KindInvalidArgument, "invitation id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return AccessGrant{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}

	invitation, err := s.queries.GetInvitation(ctx, input.InvitationID)
	if err != nil {
		return AccessGrant{}, mapNotFoundOrInternal(err, "invitation not found")
	}
	if invitation.Status != "pending" {
		return AccessGrant{}, apperr.New(apperr.KindConflict, "invitation is not pending")
	}
	if invitation.ExpiresAt.Valid && !invitation.ExpiresAt.Time.After(time.Now()) {
		return AccessGrant{}, apperr.New(apperr.KindConflict, "invitation has expired")
	}
	if !matchesInvitee(invitation.InviteeEmail, invitation.InviteePhone, input.ActorEmail, input.ActorPhone) {
		return AccessGrant{}, apperr.New(apperr.KindPermissionDenied, "invitation does not belong to current user")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return AccessGrant{}, apperr.Wrap(apperr.KindInternal, "begin accept invitation transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	accepted, err := q.AcceptInvitation(ctx, input.InvitationID)
	if err != nil {
		return AccessGrant{}, mapNotFoundOrInternal(err, "pending invitation not found")
	}
	created, err := q.CreateAccessGrant(ctx, sqlc.CreateAccessGrantParams{
		WorkspaceID:    accepted.WorkspaceID,
		SubjectID:      input.ActorUserID,
		RoleID:         accepted.RoleID,
		ScopeType:      accepted.ScopeType,
		ScopeID:        accepted.ScopeID,
		ExpiresAt:      accepted.ExpiresAt,
		AllowReshare:   false,
		AllowApiAccess: false,
		CreatedBy:      accepted.InvitedBy,
	})
	if err != nil {
		return AccessGrant{}, mapWriteError(err, "create access grant from invitation")
	}

	if err := tx.Commit(ctx); err != nil {
		return AccessGrant{}, apperr.Wrap(apperr.KindInternal, "commit accept invitation transaction", err)
	}
	committed = true

	return grantFromSQL(created, RoleSummary{
		ID:   invitation.RoleID,
		Code: invitation.RoleCode,
		Name: invitation.RoleName,
	}, SubjectSummary{
		Type: "user",
		ID:   input.ActorUserID,
	}), nil
}

func (s *Service) RevokeInvitation(ctx context.Context, invitationID uuid.UUID) (Invitation, error) {
	if invitationID == uuid.Nil {
		return Invitation{}, apperr.New(apperr.KindInvalidArgument, "invitation id is required")
	}

	revoked, err := s.queries.RevokeInvitation(ctx, invitationID)
	if err != nil {
		return Invitation{}, mapNotFoundOrInternal(err, "pending invitation not found")
	}
	row, err := s.queries.GetInvitation(ctx, revoked.ID)
	if err != nil {
		return Invitation{}, mapNotFoundOrInternal(err, "invitation not found")
	}
	return invitationFromGetRow(row), nil
}

func (s *Service) resolveSubject(ctx context.Context, input CreateGrantInput) (SubjectSummary, error) {
	switch {
	case input.SubjectUserID != uuid.Nil:
		user, err := s.queries.GetActiveUser(ctx, input.SubjectUserID)
		if err != nil {
			return SubjectSummary{}, mapNotFoundOrInternal(err, "target user not found")
		}
		return subjectFromUser(user), nil
	case strings.TrimSpace(input.Email) != "":
		email := strings.TrimSpace(input.Email)
		user, err := s.queries.FindActiveUserByEmail(ctx, &email)
		if err != nil {
			return SubjectSummary{}, mapNotFoundOrInternal(err, "target user not found")
		}
		return subjectFromUser(user), nil
	default:
		phone := strings.TrimSpace(input.Phone)
		user, err := s.queries.FindActiveUserByPhone(ctx, &phone)
		if err != nil {
			return SubjectSummary{}, mapNotFoundOrInternal(err, "target user not found")
		}
		return subjectFromUser(user), nil
	}
}

type resolvedScope struct {
	workspaceID uuid.UUID
	scopeType   string
	scopeID     uuid.UUID
}

func (s *Service) resolveScope(ctx context.Context, scopeType string, scopeID uuid.UUID) (resolvedScope, error) {
	scopeType = strings.TrimSpace(scopeType)
	switch scopeType {
	case "workspace":
		workspace, err := s.queries.GetWorkspace(ctx, scopeID)
		if err != nil {
			return resolvedScope{}, mapNotFoundOrInternal(err, "workspace not found")
		}
		return resolvedScope{workspaceID: workspace.ID, scopeType: "workspace", scopeID: workspace.ID}, nil
	case "project":
		project, err := s.queries.GetProject(ctx, scopeID)
		if err != nil {
			return resolvedScope{}, mapNotFoundOrInternal(err, "project not found")
		}
		return resolvedScope{workspaceID: project.WorkspaceID, scopeType: "project", scopeID: project.ID}, nil
	case "site":
		site, err := s.queries.GetSite(ctx, scopeID)
		if err != nil {
			return resolvedScope{}, mapNotFoundOrInternal(err, "site not found")
		}
		return resolvedScope{workspaceID: site.WorkspaceID, scopeType: "site", scopeID: site.ID}, nil
	case "device":
		device, err := s.queries.GetDevice(ctx, scopeID)
		if err != nil {
			return resolvedScope{}, mapNotFoundOrInternal(err, "device not found")
		}
		return resolvedScope{workspaceID: device.WorkspaceID, scopeType: "device", scopeID: device.ID}, nil
	case "dataset":
		dataset, err := s.queries.GetDataset(ctx, scopeID)
		if err != nil {
			return resolvedScope{}, mapNotFoundOrInternal(err, "dataset not found")
		}
		return resolvedScope{workspaceID: dataset.WorkspaceID, scopeType: "dataset", scopeID: dataset.ID}, nil
	default:
		return resolvedScope{}, apperr.New(apperr.KindInvalidArgument, "invalid scope_type")
	}
}

func (s *Service) resolveRole(ctx context.Context, roleCode string, scopeType string, expiresAt *time.Time) (RoleSummary, error) {
	roleCode = strings.TrimSpace(roleCode)
	scopeType = strings.TrimSpace(scopeType)
	if !isAccessGrantRole(roleCode) {
		return RoleSummary{}, apperr.New(apperr.KindInvalidArgument, "invalid role_code for access grant")
	}
	if roleCode == serviceEngineerRoleCode {
		if expiresAt == nil {
			return RoleSummary{}, apperr.New(apperr.KindInvalidArgument, "service engineer grants require expires_at")
		}
		if scopeType != "device" && scopeType != "site" {
			return RoleSummary{}, apperr.New(apperr.KindInvalidArgument, "service engineer grants require device or site scope")
		}
	}

	role, err := s.queries.GetSystemRoleByCode(ctx, roleCode)
	if err != nil {
		return RoleSummary{}, mapNotFoundOrInternal(err, "role not found")
	}
	return RoleSummary{ID: role.ID, Code: role.Code, Name: role.Name}, nil
}

func validateTargetSelector(userID uuid.UUID, email string, phone string) error {
	selectors := 0
	if userID != uuid.Nil {
		selectors++
	}
	if strings.TrimSpace(email) != "" {
		selectors++
	}
	if strings.TrimSpace(phone) != "" {
		selectors++
	}
	if selectors != 1 {
		return apperr.New(apperr.KindInvalidArgument, "exactly one of subject_user_id, email, or phone is required")
	}
	return nil
}

func validateExpiresAt(expiresAt *time.Time) error {
	if expiresAt != nil && !expiresAt.After(time.Now()) {
		return apperr.New(apperr.KindInvalidArgument, "expires_at must be in the future")
	}
	return nil
}

func isAccessGrantRole(roleCode string) bool {
	switch roleCode {
	case "project_manager", "site_operator", "data_manager", "researcher", "viewer", "shared_viewer", "shared_downloader", "service_engineer":
		return true
	default:
		return false
	}
}

func matchesInvitee(inviteeEmail *string, inviteePhone *string, actorEmail *string, actorPhone *string) bool {
	if inviteeEmail != nil && actorEmail != nil && strings.EqualFold(strings.TrimSpace(*inviteeEmail), strings.TrimSpace(*actorEmail)) {
		return true
	}
	if inviteePhone != nil && actorPhone != nil && strings.TrimSpace(*inviteePhone) == strings.TrimSpace(*actorPhone) {
		return true
	}
	return false
}

func subjectFromUser(user sqlc.User) SubjectSummary {
	return SubjectSummary{
		Type:  "user",
		ID:    user.ID,
		Name:  user.Name,
		Phone: user.Phone,
		Email: user.Email,
	}
}

func grantFromSQL(model sqlc.AccessGrant, role RoleSummary, subject SubjectSummary) AccessGrant {
	return AccessGrant{
		ID:             model.ID,
		WorkspaceID:    model.WorkspaceID,
		Subject:        subject,
		Role:           role,
		ScopeType:      model.ScopeType,
		ScopeID:        model.ScopeID,
		ExpiresAt:      pgTimePtr(model.ExpiresAt),
		AllowReshare:   model.AllowReshare,
		AllowAPIAccess: model.AllowApiAccess,
		CreatedBy:      model.CreatedBy,
		Status:         model.Status,
		CreatedAt:      pgTimeValue(model.CreatedAt),
		UpdatedAt:      pgTimeValue(model.UpdatedAt),
	}
}

func grantFromGetRow(row sqlc.GetAccessGrantRow) AccessGrant {
	return AccessGrant{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		Subject: SubjectSummary{
			Type: row.SubjectType,
			ID:   row.SubjectID,
		},
		Role: RoleSummary{
			ID:   row.RoleID,
			Code: row.RoleCode,
			Name: row.RoleName,
		},
		ScopeType:      row.ScopeType,
		ScopeID:        row.ScopeID,
		ExpiresAt:      pgTimePtr(row.ExpiresAt),
		AllowReshare:   row.AllowReshare,
		AllowAPIAccess: row.AllowApiAccess,
		CreatedBy:      row.CreatedBy,
		Status:         row.Status,
		CreatedAt:      pgTimeValue(row.CreatedAt),
		UpdatedAt:      pgTimeValue(row.UpdatedAt),
	}
}

func grantFromWorkspaceRow(row sqlc.ListAccessGrantsByWorkspaceRow) AccessGrant {
	return AccessGrant{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		Subject: SubjectSummary{
			Type:  row.SubjectType,
			ID:    row.SubjectID,
			Name:  row.SubjectName,
			Phone: row.SubjectPhone,
			Email: row.SubjectEmail,
		},
		Role: RoleSummary{
			ID:   row.RoleID,
			Code: row.RoleCode,
			Name: row.RoleName,
		},
		ScopeType:      row.ScopeType,
		ScopeID:        row.ScopeID,
		ExpiresAt:      pgTimePtr(row.ExpiresAt),
		AllowReshare:   row.AllowReshare,
		AllowAPIAccess: row.AllowApiAccess,
		CreatedBy:      row.CreatedBy,
		Status:         row.Status,
		CreatedAt:      pgTimeValue(row.CreatedAt),
		UpdatedAt:      pgTimeValue(row.UpdatedAt),
	}
}

func grantFromUserRow(row sqlc.ListAccessGrantsForUserRow) AccessGrant {
	return AccessGrant{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		Subject: SubjectSummary{
			Type: row.SubjectType,
			ID:   row.SubjectID,
		},
		Role: RoleSummary{
			ID:   row.RoleID,
			Code: row.RoleCode,
			Name: row.RoleName,
		},
		ScopeType:      row.ScopeType,
		ScopeID:        row.ScopeID,
		ExpiresAt:      pgTimePtr(row.ExpiresAt),
		AllowReshare:   row.AllowReshare,
		AllowAPIAccess: row.AllowApiAccess,
		CreatedBy:      row.CreatedBy,
		Status:         row.Status,
		CreatedAt:      pgTimeValue(row.CreatedAt),
		UpdatedAt:      pgTimeValue(row.UpdatedAt),
	}
}

func invitationFromSQL(model sqlc.Invitation, role RoleSummary) Invitation {
	return Invitation{
		ID:           model.ID,
		WorkspaceID:  model.WorkspaceID,
		InviteeEmail: model.InviteeEmail,
		InviteePhone: model.InviteePhone,
		Role:         role,
		ScopeType:    model.ScopeType,
		ScopeID:      model.ScopeID,
		ExpiresAt:    pgTimePtr(model.ExpiresAt),
		InvitedBy:    model.InvitedBy,
		Status:       model.Status,
		CreatedAt:    pgTimeValue(model.CreatedAt),
		UpdatedAt:    pgTimeValue(model.UpdatedAt),
	}
}

func invitationFromGetRow(row sqlc.GetInvitationRow) Invitation {
	return Invitation{
		ID:           row.ID,
		WorkspaceID:  row.WorkspaceID,
		InviteeEmail: row.InviteeEmail,
		InviteePhone: row.InviteePhone,
		Role: RoleSummary{
			ID:   row.RoleID,
			Code: row.RoleCode,
			Name: row.RoleName,
		},
		ScopeType: row.ScopeType,
		ScopeID:   row.ScopeID,
		ExpiresAt: pgTimePtr(row.ExpiresAt),
		InvitedBy: row.InvitedBy,
		Status:    row.Status,
		CreatedAt: pgTimeValue(row.CreatedAt),
		UpdatedAt: pgTimeValue(row.UpdatedAt),
	}
}

func invitationFromWorkspaceRow(row sqlc.ListInvitationsByWorkspaceRow) Invitation {
	return Invitation{
		ID:           row.ID,
		WorkspaceID:  row.WorkspaceID,
		InviteeEmail: row.InviteeEmail,
		InviteePhone: row.InviteePhone,
		Role: RoleSummary{
			ID:   row.RoleID,
			Code: row.RoleCode,
			Name: row.RoleName,
		},
		ScopeType: row.ScopeType,
		ScopeID:   row.ScopeID,
		ExpiresAt: pgTimePtr(row.ExpiresAt),
		InvitedBy: row.InvitedBy,
		Status:    row.Status,
		CreatedAt: pgTimeValue(row.CreatedAt),
		UpdatedAt: pgTimeValue(row.UpdatedAt),
	}
}

func invitationFromIdentityRow(row sqlc.ListPendingInvitationsForIdentityRow) Invitation {
	return Invitation{
		ID:           row.ID,
		WorkspaceID:  row.WorkspaceID,
		InviteeEmail: row.InviteeEmail,
		InviteePhone: row.InviteePhone,
		Role: RoleSummary{
			ID:   row.RoleID,
			Code: row.RoleCode,
			Name: row.RoleName,
		},
		ScopeType: row.ScopeType,
		ScopeID:   row.ScopeID,
		ExpiresAt: pgTimePtr(row.ExpiresAt),
		InvitedBy: row.InvitedBy,
		Status:    row.Status,
		CreatedAt: pgTimeValue(row.CreatedAt),
		UpdatedAt: pgTimeValue(row.UpdatedAt),
	}
}

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func pgTime(value *time.Time) pgtype.Timestamptz {
	if value == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *value, Valid: true}
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
