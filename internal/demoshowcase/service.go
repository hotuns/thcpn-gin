package demoshowcase

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
)

type Service struct{ db *pgxpool.Pool }

type Config struct {
	UserID        uuid.UUID `json:"user_id"`
	Name          string    `json:"name"`
	Phone         *string   `json:"phone,omitempty"`
	Email         *string   `json:"email,omitempty"`
	WorkspaceID   uuid.UUID `json:"workspace_id"`
	WorkspaceName string    `json:"workspace_name"`
}

type Device struct {
	ID            uuid.UUID  `json:"id"`
	Name          string     `json:"name"`
	SerialNo      string     `json:"serial_no"`
	DeviceType    string     `json:"device_type"`
	Status        string     `json:"status"`
	WorkspaceID   *uuid.UUID `json:"workspace_id,omitempty"`
	WorkspaceName string     `json:"workspace_name,omitempty"`
	ProjectName   string     `json:"project_name,omitempty"`
	SiteName      string     `json:"site_name,omitempty"`
	Selected      bool       `json:"selected"`
	AddedAt       *time.Time `json:"added_at,omitempty"`
}

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

func (s *Service) Get(ctx context.Context) (Config, error) {
	var item Config
	err := s.db.QueryRow(ctx, `SELECT u.id,u.name,u.phone,u.email,w.id,w.name FROM users u JOIN workspaces w ON w.owner_user_id=u.id AND w.is_demo_workspace=true WHERE u.is_demo=true`).Scan(&item.UserID, &item.Name, &item.Phone, &item.Email, &item.WorkspaceID, &item.WorkspaceName)
	if err != nil {
		if err == pgx.ErrNoRows {
			return Config{}, apperr.New(apperr.KindNotFound, "demo account is not configured")
		}
		return Config{}, apperr.Wrap(apperr.KindInternal, "get demo account", err)
	}
	return item, nil
}

func (s *Service) Configure(ctx context.Context, userID uuid.UUID) (Config, error) {
	if userID == uuid.Nil {
		return Config{}, apperr.New(apperr.KindInvalidArgument, "user_id is required")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Config{}, apperr.Wrap(apperr.KindInternal, "begin demo configuration", err)
	}
	defer tx.Rollback(ctx)
	var existing uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE is_demo=true FOR UPDATE`).Scan(&existing)
	if err == nil && existing != userID {
		return Config{}, apperr.New(apperr.KindConflict, "another demo account is already configured")
	}
	if err != nil && err != pgx.ErrNoRows {
		return Config{}, apperr.Wrap(apperr.KindInternal, "check demo account", err)
	}
	var workspaceID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT w.id FROM workspaces w JOIN users u ON u.id=w.owner_user_id WHERE w.owner_user_id=$1 AND w.type='personal' AND u.status='active' ORDER BY w.created_at LIMIT 1`, userID).Scan(&workspaceID)
	if err != nil {
		return Config{}, apperr.Wrap(apperr.KindNotFound, "demo user personal workspace not found", err)
	}
	if _, err = tx.Exec(ctx, `UPDATE users SET is_demo=true,updated_at=now() WHERE id=$1 AND status='active'`, userID); err != nil {
		return Config{}, apperr.Wrap(apperr.KindInternal, "mark demo account", err)
	}
	if _, err = tx.Exec(ctx, `UPDATE workspaces SET is_demo_workspace=true,name='演示空间',updated_at=now() WHERE id=$1`, workspaceID); err != nil {
		return Config{}, apperr.Wrap(apperr.KindInternal, "configure demo workspace", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Config{}, apperr.Wrap(apperr.KindInternal, "commit demo configuration", err)
	}
	return s.Get(ctx)
}

func (s *Service) ListDevices(ctx context.Context, query string) ([]Device, error) {
	config, err := s.Get(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT d.id,d.name,d.serial_no,d.device_type,d.status,da.workspace_id,COALESCE(w.name,''),COALESCE(p.name,''),COALESCE(st.name,''),dsd.device_id IS NOT NULL,dsd.created_at
		FROM devices d LEFT JOIN device_assignments da ON da.device_id=d.id AND da.status='active' LEFT JOIN workspaces w ON w.id=da.workspace_id LEFT JOIN projects p ON p.id=da.project_id LEFT JOIN sites st ON st.id=da.site_id LEFT JOIN demo_showcase_devices dsd ON dsd.device_id=d.id AND dsd.user_id=$1
		WHERE ($2='' OR d.name ILIKE '%%'||$2||'%%' OR d.serial_no ILIKE '%%'||$2||'%%') ORDER BY dsd.device_id IS NOT NULL DESC,d.name LIMIT 200`, config.UserID, strings.TrimSpace(query))
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list demo devices", err)
	}
	defer rows.Close()
	items := []Device{}
	for rows.Next() {
		var item Device
		if err := rows.Scan(&item.ID, &item.Name, &item.SerialNo, &item.DeviceType, &item.Status, &item.WorkspaceID, &item.WorkspaceName, &item.ProjectName, &item.SiteName, &item.Selected, &item.AddedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) AddDevice(ctx context.Context, deviceID, adminID uuid.UUID) error {
	config, err := s.Get(ctx)
	if err != nil {
		return err
	}
	result, err := s.db.Exec(ctx, `INSERT INTO demo_showcase_devices(user_id,workspace_id,device_id,added_by) SELECT $1,$2,id,$4 FROM devices WHERE id=$3 ON CONFLICT(device_id) DO NOTHING`, config.UserID, config.WorkspaceID, deviceID, adminID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "add demo device", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "device not found or already selected")
	}
	return nil
}

func (s *Service) RemoveDevice(ctx context.Context, deviceID uuid.UUID) error {
	result, err := s.db.Exec(ctx, `DELETE FROM demo_showcase_devices WHERE device_id=$1`, deviceID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "remove demo device", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "demo device not found")
	}
	return nil
}
