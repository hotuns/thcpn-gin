package adminuser

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
)

type Service struct {
	db      *pgxpool.Pool
	passCfg config.PasswordConfig
}

type ListInput struct {
	Search       string
	Status       string
	Verification string
	MFA          string
	Locked       string
	LoginStatus  string
	Sort         string
	Order        string
	Page         int
	PageSize     int
}

type UserSummary struct {
	ID                  uuid.UUID  `json:"id"`
	Name                string     `json:"name"`
	Phone               *string    `json:"phone,omitempty"`
	Email               *string    `json:"email,omitempty"`
	Status              string     `json:"status"`
	PhoneVerifiedAt     *time.Time `json:"phone_verified_at,omitempty"`
	EmailVerifiedAt     *time.Time `json:"email_verified_at,omitempty"`
	LastLoginAt         *time.Time `json:"last_login_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	WorkspaceCount      int64      `json:"workspace_count"`
	OwnedWorkspaceCount int64      `json:"owned_workspace_count"`
	ActiveSessionCount  int64      `json:"active_session_count"`
	MFAEnabled          bool       `json:"mfa_enabled"`
	Locked              bool       `json:"locked"`
	LockedUntil         *time.Time `json:"locked_until,omitempty"`
	FailedAttempts      int        `json:"failed_attempts"`
	MustChangePassword  bool       `json:"must_change_password"`
}

type UserDetail struct {
	UserSummary
	AuthVersion int `json:"auth_version"`
}

type ListResult struct {
	Items    []UserSummary `json:"items"`
	Total    int64         `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
}

type WorkspaceRelation struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Type     string    `json:"type"`
	Status   string    `json:"status"`
	Owner    bool      `json:"owner"`
	RoleCode string    `json:"role_code"`
	RoleName string    `json:"role_name"`
	JoinedAt time.Time `json:"joined_at"`
}

type Session struct {
	ID         uuid.UUID  `json:"id"`
	UserAgent  *string    `json:"user_agent,omitempty"`
	ClientIP   *string    `json:"client_ip,omitempty"`
	ExpiresAt  time.Time  `json:"expires_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type Activity struct {
	ID           uuid.UUID  `json:"id"`
	ActorType    string     `json:"actor_type"`
	ActorName    *string    `json:"actor_name,omitempty"`
	Action       string     `json:"action"`
	ResourceType string     `json:"resource_type"`
	ResourceID   *uuid.UUID `json:"resource_id,omitempty"`
	Result       string     `json:"result"`
	Reason       *string    `json:"reason,omitempty"`
	RequestID    *string    `json:"request_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type Blocker struct {
	Code      string            `json:"code"`
	Label     string            `json:"label"`
	Count     int64             `json:"count"`
	Resources []BlockerResource `json:"resources,omitempty"`
}

type BlockerResource struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Type string    `json:"type"`
}

type WorkspaceRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type DeletionCheck struct {
	CanDelete              bool           `json:"can_delete"`
	Blockers               []Blocker      `json:"blockers"`
	PersonalWorkspaceClean []WorkspaceRef `json:"personal_workspaces_to_clean"`
}

type CreateInput struct {
	Name  string
	Email string
	Phone string
}

type UpdateInput struct {
	Name  string
	Email *string
	Phone *string
}

func NewService(db *pgxpool.Pool, passCfg config.PasswordConfig) *Service {
	return &Service{db: db, passCfg: passCfg}
}

func (s *Service) List(ctx context.Context, input ListInput) (ListResult, error) {
	page, size := normalizePage(input.Page, input.PageSize)
	where, args := userConditions(input)
	base := userBaseQuery()
	var total int64
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM ("+base+") u WHERE "+where, args...).Scan(&total); err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "count admin users", err)
	}
	orderColumn := "u.created_at"
	switch input.Sort {
	case "name":
		orderColumn = "u.name"
	case "last_login":
		orderColumn = "u.last_login_at"
	case "workspaces":
		orderColumn = "u.workspace_count"
	case "sessions":
		orderColumn = "u.active_session_count"
	}
	order := "DESC"
	if strings.EqualFold(input.Order, "asc") {
		order = "ASC"
	}
	args = append(args, size, (page-1)*size)
	query := fmt.Sprintf("SELECT * FROM (%s) u WHERE %s ORDER BY %s %s NULLS LAST, u.id LIMIT $%d OFFSET $%d", base, where, orderColumn, order, len(args)-1, len(args))
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "list admin users", err)
	}
	defer rows.Close()
	items := make([]UserSummary, 0, size)
	for rows.Next() {
		item, err := scanUser(rows)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, apperr.Wrap(apperr.KindInternal, "list admin users", err)
	}
	return ListResult{Items: items, Total: total, Page: page, PageSize: size}, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (UserDetail, error) {
	if id == uuid.Nil {
		return UserDetail{}, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	row := s.db.QueryRow(ctx, "SELECT * FROM ("+userBaseQuery()+") u WHERE u.id = $1", id)
	item, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return UserDetail{}, apperr.New(apperr.KindNotFound, "user not found")
		}
		return UserDetail{}, err
	}
	var version int
	if err := s.db.QueryRow(ctx, "SELECT auth_version FROM users WHERE id = $1", id).Scan(&version); err != nil {
		return UserDetail{}, apperr.Wrap(apperr.KindInternal, "get user auth version", err)
	}
	return UserDetail{UserSummary: item, AuthVersion: version}, nil
}

func (s *Service) Workspaces(ctx context.Context, id uuid.UUID) ([]WorkspaceRelation, error) {
	rows, err := s.db.Query(ctx, `
		SELECT w.id, w.name, w.type, w.status, (w.owner_user_id = $1), r.code, r.name, wm.joined_at
		FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id JOIN roles r ON r.id = wm.role_id
		WHERE wm.user_id = $1 AND wm.status <> 'removed'
		ORDER BY w.name, wm.joined_at`, id)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list user workspaces", err)
	}
	defer rows.Close()
	items := []WorkspaceRelation{}
	for rows.Next() {
		var item WorkspaceRelation
		if err := rows.Scan(&item.ID, &item.Name, &item.Type, &item.Status, &item.Owner, &item.RoleCode, &item.RoleName, &item.JoinedAt); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan user workspace", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Sessions(ctx context.Context, id uuid.UUID) ([]Session, error) {
	rows, err := s.db.Query(ctx, `SELECT id, user_agent, client_ip, expires_at, last_used_at, created_at FROM auth_refresh_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_used_at DESC NULLS LAST, created_at DESC`, id)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list user sessions", err)
	}
	defer rows.Close()
	items := []Session{}
	for rows.Next() {
		var item Session
		if err := rows.Scan(&item.ID, &item.UserAgent, &item.ClientIP, &item.ExpiresAt, &item.LastUsedAt, &item.CreatedAt); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan user session", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Activity(ctx context.Context, id uuid.UUID, page, pageSize int) ([]Activity, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	var total int64
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE resource_type = 'user' AND resource_id = $1 OR actor_id = $1`, id).Scan(&total); err != nil {
		return nil, 0, apperr.Wrap(apperr.KindInternal, "count user activity", err)
	}
	rows, err := s.db.Query(ctx, `
		SELECT a.id, a.actor_type, COALESCE(sa.name, u.name), a.action, a.resource_type, a.resource_id, a.result, a.reason, a.request_id, a.created_at
		FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN system_admins sa ON sa.id = a.actor_admin_id
		WHERE (a.resource_type = 'user' AND a.resource_id = $1) OR a.actor_id = $1
		ORDER BY a.created_at DESC, a.id DESC LIMIT $2 OFFSET $3`, id, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.KindInternal, "list user activity", err)
	}
	defer rows.Close()
	items := []Activity{}
	for rows.Next() {
		var item Activity
		if err := rows.Scan(&item.ID, &item.ActorType, &item.ActorName, &item.Action, &item.ResourceType, &item.ResourceID, &item.Result, &item.Reason, &item.RequestID, &item.CreatedAt); err != nil {
			return nil, 0, apperr.Wrap(apperr.KindInternal, "scan user activity", err)
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (s *Service) Create(ctx context.Context, input CreateInput) (UserDetail, string, error) {
	name := strings.TrimSpace(input.Name)
	email := normalizeEmail(input.Email)
	phone := strings.TrimSpace(input.Phone)
	if name == "" {
		return UserDetail{}, "", apperr.New(apperr.KindInvalidArgument, "name is required")
	}
	if email == "" && phone == "" {
		return UserDetail{}, "", apperr.New(apperr.KindInvalidArgument, "email or phone is required")
	}
	if phone != "" {
		normalized, err := auth.NormalizePhone(phone)
		if err != nil {
			return UserDetail{}, "", err
		}
		phone = normalized
	}
	temporary, err := generateTemporaryPassword()
	if err != nil {
		return UserDetail{}, "", err
	}
	hash, err := auth.HashPassword(temporary)
	if err != nil {
		return UserDetail{}, "", apperr.Wrap(apperr.KindInternal, "hash temporary password", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return UserDetail{}, "", apperr.Wrap(apperr.KindInternal, "begin create user", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO users (name, email, phone) VALUES ($1, NULLIF($2, ''), NULLIF($3, '')) RETURNING id`, name, email, phone).Scan(&id); err != nil {
		return UserDetail{}, "", mapUniqueError(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO user_credentials (user_id, password_hash, must_change_password) VALUES ($1, $2, true)`, id, hash); err != nil {
		return UserDetail{}, "", apperr.Wrap(apperr.KindInternal, "create user credentials", err)
	}
	var workspaceID, memberID, roleID uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO workspaces (type, name, owner_user_id) VALUES ('personal', $1, $2) RETURNING id`, personalWorkspaceName(name), id).Scan(&workspaceID); err != nil {
		return UserDetail{}, "", apperr.Wrap(apperr.KindInternal, "create personal workspace", err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM roles WHERE code = 'owner' AND workspace_id IS NULL`).Scan(&roleID); err != nil {
		return UserDetail{}, "", apperr.Wrap(apperr.KindInternal, "find owner role", err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role_id, scope_type, scope_id, template_code) VALUES ($1, $2, $3, 'workspace', $1, 'owner') RETURNING id`, workspaceID, id, roleID).Scan(&memberID); err != nil {
		return UserDetail{}, "", apperr.Wrap(apperr.KindInternal, "create owner membership", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_member_permissions (member_id, permission_id) SELECT $1, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $2`, memberID, roleID); err != nil {
		return UserDetail{}, "", apperr.Wrap(apperr.KindInternal, "create owner permissions", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return UserDetail{}, "", apperr.Wrap(apperr.KindInternal, "commit user creation", err)
	}
	detail, err := s.Get(ctx, id)
	return detail, temporary, err
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, input UpdateInput) (UserDetail, error) {
	if id == uuid.Nil {
		return UserDetail{}, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return UserDetail{}, apperr.New(apperr.KindInvalidArgument, "name is required")
	}
	var email, phone *string
	if input.Email != nil {
		value := normalizeEmail(*input.Email)
		if value != "" {
			email = &value
		}
	}
	if input.Phone != nil && strings.TrimSpace(*input.Phone) != "" {
		value, err := auth.NormalizePhone(*input.Phone)
		if err != nil {
			return UserDetail{}, err
		}
		phone = &value
	}
	if email == nil && phone == nil {
		return UserDetail{}, apperr.New(apperr.KindInvalidArgument, "email or phone is required")
	}
	_, err := s.db.Exec(ctx, `UPDATE users SET name = $2, email = $3, phone = $4, email_verified_at = CASE WHEN email IS DISTINCT FROM $3 THEN NULL ELSE email_verified_at END, phone_verified_at = CASE WHEN phone IS DISTINCT FROM $4 THEN NULL ELSE phone_verified_at END, updated_at = now() WHERE id = $1`, id, name, email, phone)
	if err != nil {
		return UserDetail{}, mapUniqueError(err)
	}
	return s.Get(ctx, id)
}

func (s *Service) UpdateStatus(ctx context.Context, id uuid.UUID, status string) error {
	if status != "active" && status != "disabled" {
		return apperr.New(apperr.KindInvalidArgument, "status must be active or disabled")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin user status update", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `UPDATE users SET status = $2, auth_version = auth_version + 1, updated_at = now() WHERE id = $1`, id, status)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "update user status", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "user not found")
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, id); err != nil {
		return apperr.Wrap(apperr.KindInternal, "revoke disabled user sessions", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit user status update", err)
	}
	return nil
}

func (s *Service) RevokeAllSessions(ctx context.Context, id uuid.UUID) error {
	result, err := s.db.Exec(ctx, `UPDATE users SET auth_version = auth_version + 1, updated_at = now() WHERE id = $1`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "invalidate user access tokens", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "user not found")
	}
	_, err = s.db.Exec(ctx, `UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "revoke user sessions", err)
	}
	return nil
}

func (s *Service) Unlock(ctx context.Context, id uuid.UUID) error {
	result, err := s.db.Exec(ctx, `UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "unlock user", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "user credentials not found")
	}
	return nil
}

func (s *Service) ResetMFA(ctx context.Context, id uuid.UUID) error {
	if _, err := s.db.Exec(ctx, `DELETE FROM user_mfa_totp WHERE user_id = $1`, id); err != nil {
		return apperr.Wrap(apperr.KindInternal, "reset user mfa", err)
	}
	return s.RevokeAllSessions(ctx, id)
}

func (s *Service) TemporaryPassword(ctx context.Context, id uuid.UUID) (string, error) {
	temporary, err := generateTemporaryPassword()
	if err != nil {
		return "", err
	}
	hash, err := auth.HashPassword(temporary)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "hash temporary password", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "begin password reset", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `UPDATE user_credentials SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL, password_updated_at = now(), updated_at = now() WHERE user_id = $1`, id, hash)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "reset user password", err)
	}
	if result.RowsAffected() == 0 {
		return "", apperr.New(apperr.KindNotFound, "user credentials not found")
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET auth_version = auth_version + 1, updated_at = now() WHERE id = $1`, id); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "invalidate password sessions", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, id); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "revoke password sessions", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "commit password reset", err)
	}
	return temporary, nil
}

func (s *Service) DeletionCheck(ctx context.Context, id uuid.UUID) (DeletionCheck, error) {
	if id == uuid.Nil {
		return DeletionCheck{}, apperr.New(apperr.KindInvalidArgument, "user id is required")
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, id).Scan(&exists); err != nil {
		return DeletionCheck{}, apperr.Wrap(apperr.KindInternal, "check user", err)
	}
	if !exists {
		return DeletionCheck{}, apperr.New(apperr.KindNotFound, "user not found")
	}
	blockers := []Blocker{}
	addCount := func(code, label, query string) error {
		var count int64
		if err := s.db.QueryRow(ctx, query, id).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			resources, err := s.blockerResources(ctx, id, code)
			if err != nil {
				return err
			}
			blockers = append(blockers, Blocker{Code: code, Label: label, Count: count, Resources: resources})
		}
		return nil
	}
	queries := []struct{ code, label, query string }{
		{"organization_owner", "组织 Workspace Owner 关系", `SELECT count(*) FROM workspaces WHERE owner_user_id = $1 AND type = 'organization'`},
		{"personal_workspace_resources", "个人 Workspace 中仍有业务资源", `SELECT count(*) FROM workspaces w WHERE w.owner_user_id = $1 AND w.type = 'personal' AND (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id <> $1 AND wm.status <> 'removed') OR EXISTS (SELECT 1 FROM projects p WHERE p.workspace_id = w.id) OR EXISTS (SELECT 1 FROM sites st WHERE st.workspace_id = w.id) OR EXISTS (SELECT 1 FROM device_assignments da WHERE da.workspace_id = w.id) OR EXISTS (SELECT 1 FROM datasets d WHERE d.workspace_id = w.id) OR EXISTS (SELECT 1 FROM access_grants ag WHERE ag.workspace_id = w.id) OR EXISTS (SELECT 1 FROM invitations i WHERE i.workspace_id = w.id))`},
		{"other_memberships", "其他 Workspace 成员关系", `SELECT count(*) FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = $1 AND wm.status <> 'removed' AND NOT (w.type = 'personal' AND w.owner_user_id = $1)`},
		{"projects", "创建的 Project", `SELECT count(*) FROM projects WHERE created_by = $1`},
		{"sites", "创建的 Site", `SELECT count(*) FROM sites WHERE created_by = $1`},
		{"datasets", "创建的数据集", `SELECT count(*) FROM datasets WHERE created_by = $1`},
		{"exports", "创建的导出任务", `SELECT count(*) FROM export_jobs WHERE requested_by = $1`},
		{"device_operations", "设备操作记录", `SELECT count(*) FROM device_operations WHERE requested_by = $1`},
		{"profile_images", "设备资料图片", `SELECT count(*) FROM device_profile_images WHERE uploaded_by = $1`},
		{"device_assignments", "设备分配记录", `SELECT count(*) FROM device_assignments WHERE assigned_by = $1`},
		{"access_grants", "创建的共享授权", `SELECT count(*) FROM access_grants WHERE created_by = $1`},
		{"invitations", "发出的邀请", `SELECT count(*) FROM invitations WHERE invited_by = $1`},
	}
	for _, item := range queries {
		if err := addCount(item.code, item.label, item.query); err != nil {
			return DeletionCheck{}, apperr.Wrap(apperr.KindInternal, "check user deletion blockers", err)
		}
	}
	rows, err := s.db.Query(ctx, `
		SELECT w.id, w.name FROM workspaces w
		WHERE w.type = 'personal' AND w.owner_user_id = $1
		AND NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id <> $1 AND wm.status <> 'removed')
		AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.workspace_id = w.id)
		AND NOT EXISTS (SELECT 1 FROM sites st WHERE st.workspace_id = w.id)
		AND NOT EXISTS (SELECT 1 FROM device_assignments da WHERE da.workspace_id = w.id)
		AND NOT EXISTS (SELECT 1 FROM datasets d WHERE d.workspace_id = w.id)
		AND NOT EXISTS (SELECT 1 FROM access_grants ag WHERE ag.workspace_id = w.id)
		AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.workspace_id = w.id)`, id)
	if err != nil {
		return DeletionCheck{}, apperr.Wrap(apperr.KindInternal, "find clean personal workspaces", err)
	}
	clean := []WorkspaceRef{}
	for rows.Next() {
		var item WorkspaceRef
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			return DeletionCheck{}, apperr.Wrap(apperr.KindInternal, "scan clean personal workspace", err)
		}
		clean = append(clean, item)
	}
	if err := rows.Err(); err != nil {
		return DeletionCheck{}, err
	}
	return DeletionCheck{CanDelete: len(blockers) == 0, Blockers: blockers, PersonalWorkspaceClean: clean}, nil
}

func (s *Service) blockerResources(ctx context.Context, userID uuid.UUID, code string) ([]BlockerResource, error) {
	var query string
	switch code {
	case "organization_owner", "personal_workspace_resources":
		query = `SELECT id, name, 'workspace' FROM workspaces WHERE owner_user_id = $1 AND type = $2 ORDER BY name LIMIT 20`
	case "other_memberships":
		query = `SELECT w.id, w.name, 'workspace' FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = $1 AND wm.status <> 'removed' AND NOT (w.type = 'personal' AND w.owner_user_id = $1) ORDER BY w.name LIMIT 20`
	case "projects":
		query = `SELECT id, name, 'project' FROM projects WHERE created_by = $1 ORDER BY created_at DESC LIMIT 20`
	case "sites":
		query = `SELECT id, name, 'site' FROM sites WHERE created_by = $1 ORDER BY created_at DESC LIMIT 20`
	case "datasets":
		query = `SELECT id, name, 'dataset' FROM datasets WHERE created_by = $1 ORDER BY created_at DESC LIMIT 20`
	case "exports":
		query = `SELECT id, export_type, 'export' FROM export_jobs WHERE requested_by = $1 ORDER BY created_at DESC LIMIT 20`
	case "device_operations":
		query = `SELECT id, operation_type, 'device_operation' FROM device_operations WHERE requested_by = $1 ORDER BY created_at DESC LIMIT 20`
	case "profile_images":
		query = `SELECT id, original_filename, 'device_profile_image' FROM device_profile_images WHERE uploaded_by = $1 ORDER BY created_at DESC LIMIT 20`
	case "device_assignments":
		query = `SELECT da.device_id, COALESCE(d.name, da.device_id::text), 'device' FROM device_assignments da JOIN devices d ON d.id = da.device_id WHERE da.assigned_by = $1 ORDER BY da.assigned_at DESC LIMIT 20`
	case "access_grants":
		query = `SELECT id, scope_type || ' 分享授权', 'access_grant' FROM access_grants WHERE created_by = $1 ORDER BY created_at DESC LIMIT 20`
	case "invitations":
		query = `SELECT id, COALESCE(invitee_email, invitee_phone, '邀请'), 'invitation' FROM invitations WHERE invited_by = $1 ORDER BY created_at DESC LIMIT 20`
	default:
		return nil, nil
	}
	args := []any{userID}
	if code == "organization_owner" {
		args = append(args, "organization")
	} else if code == "personal_workspace_resources" {
		args = append(args, "personal")
	}
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list user deletion resources", err)
	}
	defer rows.Close()
	items := []BlockerResource{}
	for rows.Next() {
		var item BlockerResource
		if err := rows.Scan(&item.ID, &item.Name, &item.Type); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan user deletion resource", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	check, err := s.DeletionCheck(ctx, id)
	if err != nil {
		return err
	}
	if !check.CanDelete {
		return apperr.New(apperr.KindConflict, "user has business references and cannot be deleted")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin user deletion", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, workspace := range check.PersonalWorkspaceClean {
		if _, err := tx.Exec(ctx, `DELETE FROM workspaces WHERE id = $1`, workspace.ID); err != nil {
			return apperr.Wrap(apperr.KindInternal, "delete empty personal workspace", err)
		}
	}
	result, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindConflict, "delete user", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "user not found")
	}
	if err := tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit user deletion", err)
	}
	return nil
}

func userBaseQuery() string {
	return `SELECT u.id, u.name, u.phone, u.email, u.status, u.phone_verified_at, u.email_verified_at, u.last_login_at, u.created_at, u.updated_at,
		(SELECT count(*) FROM workspace_members wm WHERE wm.user_id = u.id AND wm.status = 'active') AS workspace_count,
		(SELECT count(*) FROM workspaces w WHERE w.owner_user_id = u.id) AS owned_workspace_count,
		(SELECT count(*) FROM auth_refresh_sessions ars WHERE ars.user_id = u.id AND ars.revoked_at IS NULL AND ars.expires_at > now()) AS active_session_count,
		EXISTS (SELECT 1 FROM user_mfa_totp m WHERE m.user_id = u.id AND m.enabled_at IS NOT NULL) AS mfa_enabled,
		COALESCE(uc.failed_attempts, 0) AS failed_attempts,
		uc.locked_until,
		COALESCE(uc.locked_until > now(), false) AS locked,
		COALESCE(uc.must_change_password, false) AS must_change_password
		FROM users u LEFT JOIN user_credentials uc ON uc.user_id = u.id`
}

func userConditions(input ListInput) (string, []any) {
	conditions := []string{"TRUE"}
	args := []any{}
	add := func(condition string, value any) {
		args = append(args, value)
		conditions = append(conditions, fmt.Sprintf(condition, len(args)))
	}
	if q := strings.TrimSpace(input.Search); q != "" {
		add("(u.name ILIKE '%%' || $%d || '%%' OR COALESCE(u.email, '') ILIKE '%%' || $%d || '%%' OR COALESCE(u.phone, '') ILIKE '%%' || $%d || '%%' OR u.id::text ILIKE '%%' || $%d || '%%')", q)
	}
	if input.Status != "" {
		add("u.status = $%d", input.Status)
	}
	switch input.Verification {
	case "verified":
		conditions = append(conditions, "(u.email_verified_at IS NOT NULL OR u.phone_verified_at IS NOT NULL)")
	case "unverified":
		conditions = append(conditions, "u.email_verified_at IS NULL AND u.phone_verified_at IS NULL")
	}
	if input.MFA == "enabled" {
		conditions = append(conditions, "EXISTS (SELECT 1 FROM user_mfa_totp m WHERE m.user_id = u.id AND m.enabled_at IS NOT NULL)")
	} else if input.MFA == "disabled" {
		conditions = append(conditions, "NOT EXISTS (SELECT 1 FROM user_mfa_totp m WHERE m.user_id = u.id AND m.enabled_at IS NOT NULL)")
	}
	if input.Locked == "locked" {
		conditions = append(conditions, "uc.locked_until > now()")
	} else if input.Locked == "unlocked" {
		conditions = append(conditions, "(uc.locked_until IS NULL OR uc.locked_until <= now())")
	}
	if input.LoginStatus == "never" {
		conditions = append(conditions, "u.last_login_at IS NULL")
	} else if input.LoginStatus == "active" {
		conditions = append(conditions, "u.last_login_at >= now() - interval '30 days'")
	}
	return strings.Join(conditions, " AND "), args
}

func scanUser(row interface{ Scan(...any) error }) (UserSummary, error) {
	var item UserSummary
	err := row.Scan(&item.ID, &item.Name, &item.Phone, &item.Email, &item.Status, &item.PhoneVerifiedAt, &item.EmailVerifiedAt, &item.LastLoginAt, &item.CreatedAt, &item.UpdatedAt, &item.WorkspaceCount, &item.OwnedWorkspaceCount, &item.ActiveSessionCount, &item.MFAEnabled, &item.FailedAttempts, &item.LockedUntil, &item.Locked, &item.MustChangePassword)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return UserSummary{}, err
		}
		return UserSummary{}, apperr.Wrap(apperr.KindInternal, "scan admin user", err)
	}
	return item, nil
}

func normalizePage(page, size int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	return page, size
}
func normalizeEmail(value string) string       { return strings.ToLower(strings.TrimSpace(value)) }
func personalWorkspaceName(name string) string { return name + "的个人工作区" }
func mapUniqueError(err error) error {
	if strings.Contains(strings.ToLower(err.Error()), "unique") {
		return apperr.New(apperr.KindConflict, "email or phone is already in use")
	}
	return apperr.Wrap(apperr.KindInternal, "write user", err)
}

func generateTemporaryPassword() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "generate temporary password", err)
	}
	for i := range buf {
		buf[i] = alphabet[int(buf[i])%len(alphabet)]
	}
	// Ensure both password classes are present even if random selection did not.
	buf[0], buf[1] = 'A', '7'
	return string(buf), nil
}
