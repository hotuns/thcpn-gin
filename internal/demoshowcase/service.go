package demoshowcase

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db/sqlc"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$`)

type Service struct {
	db       *pgxpool.Pool
	password config.PasswordConfig
}
type Account struct {
	UserID        uuid.UUID `json:"user_id"`
	Username      string    `json:"username"`
	Name          string    `json:"name"`
	Status        string    `json:"status"`
	WorkspaceID   uuid.UUID `json:"workspace_id"`
	WorkspaceName string    `json:"workspace_name"`
	DeviceCount   int64     `json:"device_count"`
	CreatedAt     time.Time `json:"created_at"`
}
type Device struct {
	ID            uuid.UUID  `json:"id"`
	Name          string     `json:"name"`
	SerialNo      string     `json:"serial_no"`
	DeviceType    string     `json:"device_type"`
	Status        string     `json:"status"`
	WorkspaceID   *uuid.UUID `json:"source_workspace_id,omitempty"`
	WorkspaceName string     `json:"source_workspace_name,omitempty"`
	ProjectName   string     `json:"source_project_name,omitempty"`
	SiteName      string     `json:"source_site_name,omitempty"`
	Selected      bool       `json:"selected"`
	AddedAt       *time.Time `json:"added_at,omitempty"`
}

func NewService(db *pgxpool.Pool, passwords ...config.PasswordConfig) *Service {
	var p config.PasswordConfig
	if len(passwords) > 0 {
		p = passwords[0]
	}
	return &Service{db: db, password: p}
}

func (s *Service) List(ctx context.Context) ([]Account, error) {
	rows, err := s.db.Query(ctx, `SELECT u.id,COALESCE(u.username,''),u.name,u.status,w.id,w.name,count(d.device_id),u.created_at FROM users u JOIN workspaces w ON w.owner_user_id=u.id AND w.is_demo_workspace LEFT JOIN demo_showcase_devices d ON d.workspace_id=w.id WHERE u.is_demo GROUP BY u.id,w.id ORDER BY u.created_at DESC`)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list demo accounts", err)
	}
	defer rows.Close()
	items := []Account{}
	for rows.Next() {
		var v Account
		if err = rows.Scan(&v.UserID, &v.Username, &v.Name, &v.Status, &v.WorkspaceID, &v.WorkspaceName, &v.DeviceCount, &v.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Account, error) {
	var v Account
	err := s.db.QueryRow(ctx, `SELECT u.id,COALESCE(u.username,''),u.name,u.status,w.id,w.name,count(d.device_id),u.created_at FROM users u JOIN workspaces w ON w.owner_user_id=u.id AND w.is_demo_workspace LEFT JOIN demo_showcase_devices d ON d.workspace_id=w.id WHERE u.id=$1 AND u.is_demo GROUP BY u.id,w.id`, id).Scan(&v.UserID, &v.Username, &v.Name, &v.Status, &v.WorkspaceID, &v.WorkspaceName, &v.DeviceCount, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, apperr.New(apperr.KindNotFound, "demo account not found")
	}
	if err != nil {
		return v, apperr.Wrap(apperr.KindInternal, "get demo account", err)
	}
	return v, nil
}

func (s *Service) Create(ctx context.Context, username, name, password string) (Account, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	name = strings.TrimSpace(name)
	if !usernamePattern.MatchString(username) {
		return Account{}, apperr.New(apperr.KindInvalidArgument, "invalid demo username")
	}
	if name == "" {
		return Account{}, apperr.New(apperr.KindInvalidArgument, "name is required")
	}
	if err := auth.ValidatePassword(password, s.password); err != nil {
		return Account{}, err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return Account{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	var userID uuid.UUID
	if err = tx.QueryRow(ctx, `INSERT INTO users(name,username,is_demo) VALUES($1,$2,true) RETURNING id`, name, username).Scan(&userID); err != nil {
		return Account{}, writeError(err, "create demo account")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)`, userID, hash); err != nil {
		return Account{}, err
	}
	workspace, err := q.CreatePersonalWorkspace(ctx, sqlc.CreatePersonalWorkspaceParams{Name: name + "的演示空间", OwnerUserID: userID})
	if err != nil {
		return Account{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE workspaces SET is_demo_workspace=true WHERE id=$1`, workspace.ID); err != nil {
		return Account{}, err
	}
	role, err := q.GetSystemRoleByCode(ctx, "owner")
	if err != nil {
		return Account{}, err
	}
	member, err := q.CreateWorkspaceMember(ctx, sqlc.CreateWorkspaceMemberParams{WorkspaceID: workspace.ID, UserID: userID, RoleID: role.ID, ScopeType: "workspace", ScopeID: workspace.ID, TemplateCode: "owner"})
	if err != nil {
		return Account{}, err
	}
	codes, err := q.ListPermissionCodesByTemplate(ctx, "owner")
	if err != nil {
		return Account{}, err
	}
	if _, err = q.AddWorkspaceMemberPermissions(ctx, sqlc.AddWorkspaceMemberPermissionsParams{MemberID: member.ID, Column2: codes}); err != nil {
		return Account{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Account{}, err
	}
	return s.Get(ctx, userID)
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, name, status *string) (Account, error) {
	if name == nil && status == nil {
		return Account{}, apperr.New(apperr.KindInvalidArgument, "name or status is required")
	}
	if name != nil {
		v := strings.TrimSpace(*name)
		if v == "" {
			return Account{}, apperr.New(apperr.KindInvalidArgument, "name is required")
		}
		name = &v
	}
	if status != nil && *status != "active" && *status != "disabled" {
		return Account{}, apperr.New(apperr.KindInvalidArgument, "invalid status")
	}
	r, err := s.db.Exec(ctx, `UPDATE users SET name=COALESCE($2,name),status=COALESCE($3,status),auth_version=auth_version+CASE WHEN $3='disabled' THEN 1 ELSE 0 END,updated_at=now() WHERE id=$1 AND is_demo`, id, name, status)
	if err != nil {
		return Account{}, err
	}
	if r.RowsAffected() == 0 {
		return Account{}, apperr.New(apperr.KindNotFound, "demo account not found")
	}
	if name != nil {
		_, _ = s.db.Exec(ctx, `UPDATE workspaces SET name=$2||'的演示空间',updated_at=now() WHERE owner_user_id=$1 AND is_demo_workspace`, id, *name)
	}
	if status != nil && *status == "disabled" {
		_, _ = s.db.Exec(ctx, `UPDATE auth_refresh_sessions SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, id)
	}
	return s.Get(ctx, id)
}
func (s *Service) ResetPassword(ctx context.Context, id uuid.UUID, password string) error {
	if err := auth.ValidatePassword(password, s.password); err != nil {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND is_demo)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return apperr.New(apperr.KindNotFound, "demo account not found")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO user_credentials(user_id,password_hash,must_change_password,failed_attempts,locked_until,password_updated_at,updated_at) VALUES($1,$2,false,0,NULL,now(),now()) ON CONFLICT(user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,must_change_password=false,failed_attempts=0,locked_until=NULL,password_updated_at=now(),updated_at=now()`, id, hash); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE users SET auth_version=auth_version+1,updated_at=now() WHERE id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE auth_refresh_sessions SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) ListDevices(ctx context.Context, userID uuid.UUID, q string, limit, offset int) ([]Device, int, error) {
	account, err := s.Get(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	q = strings.TrimSpace(q)
	var total int
	if err = s.db.QueryRow(ctx, `SELECT count(*) FROM devices d WHERE $1='' OR d.name ILIKE '%%'||$1||'%%' OR d.serial_no ILIKE '%%'||$1||'%%'`, q).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(ctx, `SELECT d.id,d.name,d.serial_no,d.device_type,d.status,da.workspace_id,COALESCE(w.name,''),COALESCE(p.name,''),COALESCE(st.name,''),x.device_id IS NOT NULL,x.created_at FROM devices d LEFT JOIN device_assignments da ON da.device_id=d.id AND da.status='active' LEFT JOIN workspaces w ON w.id=da.workspace_id LEFT JOIN projects p ON p.id=da.project_id LEFT JOIN sites st ON st.id=da.site_id LEFT JOIN demo_showcase_devices x ON x.device_id=d.id AND x.workspace_id=$1 WHERE ($2='' OR d.name ILIKE '%%'||$2||'%%' OR d.serial_no ILIKE '%%'||$2||'%%') ORDER BY x.device_id IS NOT NULL DESC,d.name LIMIT $3 OFFSET $4`, account.WorkspaceID, q, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []Device{}
	for rows.Next() {
		var v Device
		if err = rows.Scan(&v.ID, &v.Name, &v.SerialNo, &v.DeviceType, &v.Status, &v.WorkspaceID, &v.WorkspaceName, &v.ProjectName, &v.SiteName, &v.Selected, &v.AddedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, v)
	}
	return items, total, rows.Err()
}
func (s *Service) AddDevice(ctx context.Context, userID, deviceID, adminID uuid.UUID) error {
	a, err := s.Get(ctx, userID)
	if err != nil {
		return err
	}
	r, err := s.db.Exec(ctx, `INSERT INTO demo_showcase_devices(user_id,workspace_id,device_id,added_by) SELECT $1,$2,id,$4 FROM devices WHERE id=$3 ON CONFLICT(workspace_id,device_id) DO NOTHING`, userID, a.WorkspaceID, deviceID, adminID)
	if err != nil {
		return err
	}
	if r.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "device not found or already selected")
	}
	return nil
}
func (s *Service) RemoveDevice(ctx context.Context, userID, deviceID uuid.UUID) error {
	a, err := s.Get(ctx, userID)
	if err != nil {
		return err
	}
	r, err := s.db.Exec(ctx, `DELETE FROM demo_showcase_devices WHERE workspace_id=$1 AND device_id=$2`, a.WorkspaceID, deviceID)
	if err != nil {
		return err
	}
	if r.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "demo device not found")
	}
	return nil
}
func writeError(err error, message string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return apperr.New(apperr.KindConflict, "demo username already exists")
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
