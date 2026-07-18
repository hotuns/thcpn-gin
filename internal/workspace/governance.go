package workspace

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/apperr"
)

type GovernanceOwner struct {
	ID     uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Email  *string   `json:"email,omitempty"`
	Phone  *string   `json:"phone,omitempty"`
	Status string    `json:"status"`
}

type GovernanceCounts struct {
	Members            int64 `json:"members"`
	Projects           int64 `json:"projects"`
	Sites              int64 `json:"sites"`
	Devices            int64 `json:"devices"`
	DirectShares       int64 `json:"direct_shares"`
	PendingInvitations int64 `json:"pending_invitations"`
}

type GovernanceRisk struct {
	Code  string `json:"code"`
	Label string `json:"label"`
	Count int64  `json:"count,omitempty"`
}

type GovernanceWorkspace struct {
	Workspace
	Owner          GovernanceOwner  `json:"owner"`
	Counts         GovernanceCounts `json:"counts"`
	LastActivityAt *time.Time       `json:"last_activity_at,omitempty"`
	Risks          []GovernanceRisk `json:"risks"`
}

type GovernanceListInput struct {
	Search           string
	WorkspaceType    string
	OrganizationType string
	Status           string
	Risk             string
	Sort             string
	Order            string
	Page             int
	PageSize         int
}

type GovernanceListResult struct {
	Items    []GovernanceWorkspace `json:"items"`
	Total    int64                 `json:"total"`
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
}

type AdminIntervention struct {
	ID            uuid.UUID  `json:"id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id"`
	AdminID       uuid.UUID  `json:"admin_id"`
	AdminName     string     `json:"admin_name"`
	Reason        string     `json:"reason"`
	ExpiresAt     time.Time  `json:"expires_at"`
	EndedAt       *time.Time `json:"ended_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	RemainingSecs int64      `json:"remaining_seconds"`
}

func (s *Service) AdminListGovernance(ctx context.Context, input GovernanceListInput) (GovernanceListResult, error) {
	page, pageSize := normalizePage(input.Page, input.PageSize)
	conditions := []string{"TRUE"}
	args := make([]any, 0, 8)
	add := func(format string, value any) {
		args = append(args, value)
		conditions = append(conditions, fmt.Sprintf(format, len(args)))
	}
	if value := strings.TrimSpace(input.Search); value != "" {
		args = append(args, value)
		placeholder := len(args)
		conditions = append(conditions, fmt.Sprintf("(g.name ILIKE '%%' || $%d || '%%' OR g.owner_name ILIKE '%%' || $%d || '%%' OR COALESCE(g.owner_email, '') ILIKE '%%' || $%d || '%%' OR g.id::text ILIKE '%%' || $%d || '%%')", placeholder, placeholder, placeholder, placeholder))
	}
	if value := strings.TrimSpace(input.WorkspaceType); value != "" {
		add("g.type = $%d", value)
	}
	if value := strings.TrimSpace(input.OrganizationType); value != "" {
		add("g.organization_type = $%d", value)
	}
	if value := strings.TrimSpace(input.Status); value != "" {
		add("g.status = $%d", value)
	}
	switch strings.TrimSpace(input.Risk) {
	case "owner_unavailable":
		conditions = append(conditions, "g.owner_status <> 'active'")
	case "workspace_disabled":
		conditions = append(conditions, "g.status = 'disabled'")
	case "pending_invitations":
		conditions = append(conditions, "g.pending_invitations > 0")
	case "recent_failures":
		conditions = append(conditions, "g.recent_failures > 0")
	}

	base := governanceWorkspaceQuery()
	where := strings.Join(conditions, " AND ")
	var total int64
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM ("+base+") g WHERE "+where, args...).Scan(&total); err != nil {
		return GovernanceListResult{}, apperr.Wrap(apperr.KindInternal, "count admin workspaces", err)
	}

	orderColumn := "g.updated_at"
	switch input.Sort {
	case "name":
		orderColumn = "g.name"
	case "members":
		orderColumn = "g.member_count"
	case "recent_activity":
		orderColumn = "g.last_activity_at"
	case "created_at":
		orderColumn = "g.created_at"
	}
	order := "DESC"
	if strings.EqualFold(input.Order, "asc") {
		order = "ASC"
	}
	args = append(args, pageSize, (page-1)*pageSize)
	query := fmt.Sprintf("SELECT * FROM (%s) g WHERE %s ORDER BY %s %s NULLS LAST, g.id LIMIT $%d OFFSET $%d", base, where, orderColumn, order, len(args)-1, len(args))
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return GovernanceListResult{}, apperr.Wrap(apperr.KindInternal, "list admin workspaces", err)
	}
	defer rows.Close()
	items := make([]GovernanceWorkspace, 0, pageSize)
	for rows.Next() {
		item, err := scanGovernanceWorkspace(rows)
		if err != nil {
			return GovernanceListResult{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return GovernanceListResult{}, apperr.Wrap(apperr.KindInternal, "list admin workspaces", err)
	}
	return GovernanceListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) AdminGetGovernance(ctx context.Context, workspaceID uuid.UUID) (GovernanceWorkspace, error) {
	if workspaceID == uuid.Nil {
		return GovernanceWorkspace{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	row := s.db.QueryRow(ctx, "SELECT * FROM ("+governanceWorkspaceQuery()+") g WHERE g.id = $1", workspaceID)
	item, err := scanGovernanceWorkspace(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return GovernanceWorkspace{}, apperr.New(apperr.KindNotFound, "workspace not found")
		}
		return GovernanceWorkspace{}, err
	}
	return item, nil
}

func (s *Service) StartIntervention(ctx context.Context, workspaceID, adminID uuid.UUID, reason string, durationMinutes int) (AdminIntervention, error) {
	reason = strings.TrimSpace(reason)
	if workspaceID == uuid.Nil || adminID == uuid.Nil {
		return AdminIntervention{}, apperr.New(apperr.KindInvalidArgument, "workspace and administrator are required")
	}
	if len([]rune(reason)) < 5 {
		return AdminIntervention{}, apperr.New(apperr.KindInvalidArgument, "intervention reason must contain at least 5 characters")
	}
	if durationMinutes != 15 && durationMinutes != 30 && durationMinutes != 60 {
		return AdminIntervention{}, apperr.New(apperr.KindInvalidArgument, "duration must be 15, 30, or 60 minutes")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return AdminIntervention{}, apperr.Wrap(apperr.KindInternal, "begin intervention", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `UPDATE workspace_admin_interventions SET ended_at = now(), updated_at = now() WHERE workspace_id = $1 AND admin_id = $2 AND ended_at IS NULL`, workspaceID, adminID); err != nil {
		return AdminIntervention{}, apperr.Wrap(apperr.KindInternal, "end previous intervention", err)
	}
	var item AdminIntervention
	err = tx.QueryRow(ctx, `
		INSERT INTO workspace_admin_interventions (workspace_id, admin_id, reason, expires_at)
		SELECT w.id, sa.id, $3, now() + make_interval(mins => $4)
		FROM workspaces w CROSS JOIN system_admins sa
		WHERE w.id = $1 AND sa.id = $2 AND sa.status = 'active'
		RETURNING id, workspace_id, admin_id, reason, expires_at, ended_at, created_at
	`, workspaceID, adminID, reason, durationMinutes).Scan(&item.ID, &item.WorkspaceID, &item.AdminID, &item.Reason, &item.ExpiresAt, &item.EndedAt, &item.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return AdminIntervention{}, apperr.New(apperr.KindNotFound, "workspace or administrator not found")
		}
		return AdminIntervention{}, apperr.Wrap(apperr.KindInternal, "create intervention", err)
	}
	if err := tx.QueryRow(ctx, `SELECT name FROM system_admins WHERE id = $1`, adminID).Scan(&item.AdminName); err != nil {
		return AdminIntervention{}, apperr.Wrap(apperr.KindInternal, "load intervention administrator", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminIntervention{}, apperr.Wrap(apperr.KindInternal, "commit intervention", err)
	}
	item.RemainingSecs = int64(time.Until(item.ExpiresAt).Seconds())
	return item, nil
}

func (s *Service) EndIntervention(ctx context.Context, workspaceID, interventionID, adminID uuid.UUID) error {
	result, err := s.db.Exec(ctx, `UPDATE workspace_admin_interventions SET ended_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 AND admin_id = $3 AND ended_at IS NULL`, interventionID, workspaceID, adminID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "end intervention", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "active intervention not found")
	}
	return nil
}

func (s *Service) ValidateIntervention(ctx context.Context, workspaceID, interventionID, adminID uuid.UUID) (AdminIntervention, error) {
	var item AdminIntervention
	err := s.db.QueryRow(ctx, `
		SELECT i.id, i.workspace_id, i.admin_id, sa.name, i.reason, i.expires_at, i.ended_at, i.created_at
		FROM workspace_admin_interventions i
		JOIN system_admins sa ON sa.id = i.admin_id
		WHERE i.id = $1 AND i.workspace_id = $2 AND i.admin_id = $3
			AND i.ended_at IS NULL AND i.expires_at > now() AND sa.status = 'active'
	`, interventionID, workspaceID, adminID).Scan(&item.ID, &item.WorkspaceID, &item.AdminID, &item.AdminName, &item.Reason, &item.ExpiresAt, &item.EndedAt, &item.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return AdminIntervention{}, apperr.New(apperr.KindPermissionDenied, "administrator intervention is missing or expired")
		}
		return AdminIntervention{}, apperr.Wrap(apperr.KindInternal, "validate intervention", err)
	}
	item.RemainingSecs = int64(time.Until(item.ExpiresAt).Seconds())
	return item, nil
}

func (s *Service) WorkspaceIDForResource(ctx context.Context, resourceType string, resourceID uuid.UUID) (uuid.UUID, error) {
	if resourceID == uuid.Nil {
		return uuid.Nil, apperr.New(apperr.KindInvalidArgument, "resource id is required")
	}
	queries := map[string]string{
		"project":      `SELECT workspace_id FROM projects WHERE id = $1`,
		"site":         `SELECT workspace_id FROM sites WHERE id = $1`,
		"access_grant": `SELECT workspace_id FROM access_grants WHERE id = $1`,
		"invitation":   `SELECT workspace_id FROM invitations WHERE id = $1`,
	}
	query, ok := queries[resourceType]
	if !ok {
		return uuid.Nil, apperr.New(apperr.KindInvalidArgument, "unsupported intervention resource")
	}
	var workspaceID uuid.UUID
	if err := s.db.QueryRow(ctx, query, resourceID).Scan(&workspaceID); err != nil {
		if err == pgx.ErrNoRows {
			return uuid.Nil, apperr.New(apperr.KindNotFound, "resource not found")
		}
		return uuid.Nil, apperr.Wrap(apperr.KindInternal, "resolve resource workspace", err)
	}
	return workspaceID, nil
}

func (s *Service) AdminUpdateStatus(ctx context.Context, workspaceID uuid.UUID, status string) (GovernanceWorkspace, error) {
	if status != "active" && status != "disabled" {
		return GovernanceWorkspace{}, apperr.New(apperr.KindInvalidArgument, "status must be active or disabled")
	}
	result, err := s.db.Exec(ctx, `UPDATE workspaces SET status = $2, updated_at = now() WHERE id = $1`, workspaceID, status)
	if err != nil {
		return GovernanceWorkspace{}, apperr.Wrap(apperr.KindInternal, "update workspace status", err)
	}
	if result.RowsAffected() == 0 {
		return GovernanceWorkspace{}, apperr.New(apperr.KindNotFound, "workspace not found")
	}
	return s.AdminGetGovernance(ctx, workspaceID)
}

func (s *Service) AdminTransferOwner(ctx context.Context, workspaceID, targetUserID uuid.UUID) (GovernanceWorkspace, error) {
	if workspaceID == uuid.Nil || targetUserID == uuid.Nil {
		return GovernanceWorkspace{}, apperr.New(apperr.KindInvalidArgument, "workspace and target user are required")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return GovernanceWorkspace{}, apperr.Wrap(apperr.KindInternal, "begin owner transfer", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var workspaceType string
	var currentOwner uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT type, owner_user_id FROM workspaces WHERE id = $1 FOR UPDATE`, workspaceID).Scan(&workspaceType, &currentOwner); err != nil {
		if err == pgx.ErrNoRows {
			return GovernanceWorkspace{}, apperr.New(apperr.KindNotFound, "workspace not found")
		}
		return GovernanceWorkspace{}, apperr.Wrap(apperr.KindInternal, "load workspace owner", err)
	}
	if workspaceType != "organization" {
		return GovernanceWorkspace{}, apperr.New(apperr.KindInvalidArgument, "personal workspace owner cannot be transferred")
	}
	var targetMemberID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT wm.id FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.status = 'active' AND u.status = 'active'`, workspaceID, targetUserID).Scan(&targetMemberID); err != nil {
		return GovernanceWorkspace{}, apperr.New(apperr.KindInvalidArgument, "target owner must be an active workspace member")
	}
	if targetUserID == currentOwner {
		return GovernanceWorkspace{}, apperr.New(apperr.KindConflict, "target user is already the workspace owner")
	}
	if err := applyMemberTemplate(ctx, tx, targetMemberID, "owner"); err != nil {
		return GovernanceWorkspace{}, err
	}
	var oldMemberID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, currentOwner).Scan(&oldMemberID); err == nil {
		if err := applyMemberTemplate(ctx, tx, oldMemberID, "admin"); err != nil {
			return GovernanceWorkspace{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE workspaces SET owner_user_id = $2, updated_at = now() WHERE id = $1`, workspaceID, targetUserID); err != nil {
		return GovernanceWorkspace{}, apperr.Wrap(apperr.KindInternal, "transfer workspace owner", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return GovernanceWorkspace{}, apperr.Wrap(apperr.KindInternal, "commit owner transfer", err)
	}
	return s.AdminGetGovernance(ctx, workspaceID)
}

func applyMemberTemplate(ctx context.Context, tx pgx.Tx, memberID uuid.UUID, templateCode string) error {
	var roleID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM roles WHERE workspace_id IS NULL AND code = $1`, templateCode).Scan(&roleID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "load system role", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_members SET role_id = $2, template_code = $3, scope_type = 'workspace', scope_id = workspace_id, updated_at = now() WHERE id = $1`, memberID, roleID, templateCode); err != nil {
		return apperr.Wrap(apperr.KindInternal, "update member role", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM workspace_member_permissions WHERE member_id = $1`, memberID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "reset member permissions", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_member_permissions (member_id, permission_id) SELECT $1, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $2`, memberID, roleID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "apply member permissions", err)
	}
	return nil
}

func governanceWorkspaceQuery() string {
	return `
		SELECT w.id, w.type, w.organization_type, w.name, w.owner_user_id, w.status, w.created_at, w.updated_at,
			u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone, u.status AS owner_status,
			(SELECT count(*) FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.status <> 'removed') AS member_count,
			(SELECT count(*) FROM projects p WHERE p.workspace_id = w.id) AS project_count,
			(SELECT count(*) FROM sites s WHERE s.workspace_id = w.id) AS site_count,
			(SELECT count(*) FROM device_assignments da WHERE da.workspace_id = w.id AND da.status = 'active') AS device_count,
			(SELECT count(*) FROM access_grants ag WHERE ag.workspace_id = w.id AND ag.status = 'active') AS direct_share_count,
			(SELECT count(*) FROM invitations i WHERE i.workspace_id = w.id AND i.status = 'pending') AS pending_invitations,
			(SELECT max(a.created_at) FROM audit_logs a WHERE a.workspace_id = w.id) AS last_activity_at,
			(SELECT count(*) FROM audit_logs a WHERE a.workspace_id = w.id AND a.result = 'failure' AND a.created_at >= now() - interval '7 days') AS recent_failures
		FROM workspaces w
		JOIN users u ON u.id = w.owner_user_id
	`
}

type governanceScanner interface {
	Scan(dest ...any) error
}

func scanGovernanceWorkspace(row governanceScanner) (GovernanceWorkspace, error) {
	var item GovernanceWorkspace
	var recentFailures int64
	err := row.Scan(&item.ID, &item.Type, &item.OrganizationType, &item.Name, &item.OwnerUserID, &item.Status, &item.CreatedAt, &item.UpdatedAt,
		&item.Owner.Name, &item.Owner.Email, &item.Owner.Phone, &item.Owner.Status,
		&item.Counts.Members, &item.Counts.Projects, &item.Counts.Sites, &item.Counts.Devices, &item.Counts.DirectShares, &item.Counts.PendingInvitations,
		&item.LastActivityAt, &recentFailures)
	if err != nil {
		return GovernanceWorkspace{}, apperr.Wrap(apperr.KindInternal, "scan admin workspace", err)
	}
	item.Owner.ID = item.OwnerUserID
	item.Risks = make([]GovernanceRisk, 0, 4)
	if item.Owner.Status != "active" {
		item.Risks = append(item.Risks, GovernanceRisk{Code: "owner_unavailable", Label: "Owner 不可用"})
	}
	if item.Status == "disabled" {
		item.Risks = append(item.Risks, GovernanceRisk{Code: "workspace_disabled", Label: "Workspace 已停用"})
	}
	if item.Counts.PendingInvitations > 0 {
		item.Risks = append(item.Risks, GovernanceRisk{Code: "pending_invitations", Label: "存在待处理邀请", Count: item.Counts.PendingInvitations})
	}
	if recentFailures > 0 {
		item.Risks = append(item.Risks, GovernanceRisk{Code: "recent_failures", Label: "近期失败操作", Count: recentFailures})
	}
	return item, nil
}

func normalizePage(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}
