package openapiaccess

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/billing"
)

type Service struct {
	db      *pgxpool.Pool
	billing *billing.Service
	mu      sync.Mutex
	windows map[uuid.UUID]rateWindow
}
type rateWindow struct {
	minute time.Time
	count  int
}
type APIKey struct {
	ID                uuid.UUID  `json:"id"`
	WorkspaceID       uuid.UUID  `json:"workspace_id"`
	Name              string     `json:"name"`
	KeyPrefix         string     `json:"key_prefix"`
	CreatedBy         uuid.UUID  `json:"created_by"`
	ExpiresAt         *time.Time `json:"expires_at,omitempty"`
	LastUsedAt        *time.Time `json:"last_used_at,omitempty"`
	RevokedAt         *time.Time `json:"revoked_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	RequestsThisMonth int64      `json:"requests_this_month"`
}
type CreatedAPIKey struct {
	APIKey
	Secret string `json:"secret"`
}

type OpenDevice struct {
	ID              uuid.UUID  `json:"id"`
	Name            string     `json:"name"`
	SerialNo        string     `json:"serial_no"`
	DeviceType      string     `json:"device_type"`
	Status          string     `json:"status"`
	LifecycleStatus string     `json:"lifecycle_status"`
	ProjectID       *uuid.UUID `json:"project_id,omitempty"`
	SiteID          *uuid.UUID `json:"site_id,omitempty"`
}

type OpenDataStream struct {
	ID       uuid.UUID `json:"id"`
	DeviceID uuid.UUID `json:"device_id"`
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	Type     string    `json:"type"`
	Unit     *string   `json:"unit,omitempty"`
	Status   string    `json:"status"`
}

func NewService(db *pgxpool.Pool, billingService *billing.Service) *Service {
	return &Service{db: db, billing: billingService, windows: map[uuid.UUID]rateWindow{}}
}
func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func (s *Service) Create(ctx context.Context, workspaceID, userID uuid.UUID, name string, expiresAt *time.Time) (CreatedAPIKey, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 100 {
		return CreatedAPIKey{}, apperr.New(apperr.KindInvalidArgument, "api key name is required")
	}
	if expiresAt != nil && !expiresAt.After(time.Now().UTC()) {
		return CreatedAPIKey{}, apperr.New(apperr.KindInvalidArgument, "expires_at must be in the future")
	}
	if err := s.billing.RequireProfessional(ctx, workspaceID); err != nil {
		return CreatedAPIKey{}, err
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return CreatedAPIKey{}, apperr.Wrap(apperr.KindInternal, "generate api key", err)
	}
	secret := "thcpn_" + base64.RawURLEncoding.EncodeToString(random)
	prefix := secret[:14]
	var item APIKey
	err := s.db.QueryRow(ctx, `INSERT INTO workspace_api_keys(workspace_id,name,key_prefix,secret_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,workspace_id,name,key_prefix,created_by,expires_at,last_used_at,revoked_at,created_at`, workspaceID, name, prefix, hashSecret(secret), userID, expiresAt).Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.KeyPrefix, &item.CreatedBy, &item.ExpiresAt, &item.LastUsedAt, &item.RevokedAt, &item.CreatedAt)
	if err != nil {
		return CreatedAPIKey{}, apperr.Wrap(apperr.KindInternal, "create api key", err)
	}
	return CreatedAPIKey{APIKey: item, Secret: secret}, nil
}
func (s *Service) List(ctx context.Context, workspaceID uuid.UUID) ([]APIKey, error) {
	rows, err := s.db.Query(ctx, `SELECT k.id,k.workspace_id,k.name,k.key_prefix,k.created_by,k.expires_at,k.last_used_at,k.revoked_at,k.created_at,
		COALESCE((SELECT sum(u.request_count) FROM workspace_api_usage_daily u WHERE u.api_key_id=k.id AND u.usage_date>=date_trunc('month',CURRENT_DATE)::date),0)
		FROM workspace_api_keys k WHERE k.workspace_id=$1 ORDER BY k.created_at DESC`, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list api keys", err)
	}
	defer rows.Close()
	items := []APIKey{}
	for rows.Next() {
		var item APIKey
		if err = rows.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.KeyPrefix, &item.CreatedBy, &item.ExpiresAt, &item.LastUsedAt, &item.RevokedAt, &item.CreatedAt, &item.RequestsThisMonth); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan api key", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Service) Revoke(ctx context.Context, workspaceID, keyID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `UPDATE workspace_api_keys SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE id=$1 AND workspace_id=$2`, keyID, workspaceID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "revoke api key", err)
	}
	if tag.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "api key not found")
	}
	return nil
}
func (s *Service) Authenticate(ctx context.Context, secret string) (APIKey, error) {
	secret = strings.TrimSpace(secret)
	if !strings.HasPrefix(secret, "thcpn_") {
		return APIKey{}, apperr.New(apperr.KindUnauthorized, "invalid api key")
	}
	var item APIKey
	err := s.db.QueryRow(ctx, `SELECT id,workspace_id,name,key_prefix,created_by,expires_at,last_used_at,revoked_at,created_at FROM workspace_api_keys WHERE secret_hash=$1`, hashSecret(secret)).Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.KeyPrefix, &item.CreatedBy, &item.ExpiresAt, &item.LastUsedAt, &item.RevokedAt, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return APIKey{}, apperr.New(apperr.KindUnauthorized, "invalid api key")
	}
	if err != nil {
		return APIKey{}, apperr.Wrap(apperr.KindInternal, "authenticate api key", err)
	}
	now := time.Now().UTC()
	if item.RevokedAt != nil || (item.ExpiresAt != nil && !item.ExpiresAt.After(now)) {
		return APIKey{}, apperr.New(apperr.KindUnauthorized, "api key is inactive")
	}
	if err = s.billing.RequireProfessional(ctx, item.WorkspaceID); err != nil {
		return APIKey{}, apperr.New(apperr.KindPermissionDenied, "workspace professional plan is inactive")
	}
	if !s.allow(item.ID, now) {
		return APIKey{}, apperr.New(apperr.KindRateLimited, "api key rate limit exceeded")
	}
	_, _ = s.db.Exec(ctx, `UPDATE workspace_api_keys SET last_used_at=now(),updated_at=now() WHERE id=$1`, item.ID)
	_, _ = s.db.Exec(ctx, `INSERT INTO workspace_api_usage_daily(api_key_id,usage_date,request_count,last_used_at) VALUES($1,CURRENT_DATE,1,now()) ON CONFLICT(api_key_id,usage_date) DO UPDATE SET request_count=workspace_api_usage_daily.request_count+1,last_used_at=now()`, item.ID)
	return item, nil
}
func (s *Service) allow(id uuid.UUID, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	minute := now.Truncate(time.Minute)
	current := s.windows[id]
	if !current.minute.Equal(minute) {
		current = rateWindow{minute: minute}
	}
	if current.count >= 600 {
		return false
	}
	current.count++
	s.windows[id] = current
	return true
}
func (s *Service) DeviceBelongsToWorkspace(ctx context.Context, deviceID, workspaceID uuid.UUID) error {
	var found bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM device_assignments WHERE device_id=$1 AND workspace_id=$2 AND unassigned_at IS NULL)`, deviceID, workspaceID).Scan(&found)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "check api device scope", err)
	}
	if !found {
		return apperr.New(apperr.KindNotFound, "device not found")
	}
	return nil
}

func (s *Service) ListDevices(ctx context.Context, workspaceID uuid.UUID, deviceType, status string) ([]OpenDevice, error) {
	rows, err := s.db.Query(ctx, `SELECT d.id,d.name,d.serial_no,d.device_type,d.status,d.lifecycle_status,da.project_id,da.site_id
		FROM device_assignments da JOIN devices d ON d.id=da.device_id
		WHERE da.workspace_id=$1 AND da.unassigned_at IS NULL AND ($2='' OR d.device_type=$2) AND ($3='' OR d.status=$3)
		ORDER BY d.name,d.serial_no LIMIT 500`, workspaceID, strings.TrimSpace(deviceType), strings.TrimSpace(status))
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list open api devices", err)
	}
	defer rows.Close()
	items := []OpenDevice{}
	for rows.Next() {
		var item OpenDevice
		if err = rows.Scan(&item.ID, &item.Name, &item.SerialNo, &item.DeviceType, &item.Status, &item.LifecycleStatus, &item.ProjectID, &item.SiteID); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan open api device", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) GetDevice(ctx context.Context, workspaceID, deviceID uuid.UUID) (OpenDevice, error) {
	var item OpenDevice
	err := s.db.QueryRow(ctx, `SELECT d.id,d.name,d.serial_no,d.device_type,d.status,d.lifecycle_status,da.project_id,da.site_id
		FROM device_assignments da JOIN devices d ON d.id=da.device_id WHERE da.workspace_id=$1 AND da.device_id=$2 AND da.unassigned_at IS NULL`, workspaceID, deviceID).
		Scan(&item.ID, &item.Name, &item.SerialNo, &item.DeviceType, &item.Status, &item.LifecycleStatus, &item.ProjectID, &item.SiteID)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, apperr.New(apperr.KindNotFound, "device not found")
	}
	if err != nil {
		return item, apperr.Wrap(apperr.KindInternal, "get open api device", err)
	}
	return item, nil
}

func (s *Service) ListDataStreams(ctx context.Context, workspaceID, deviceID uuid.UUID) ([]OpenDataStream, error) {
	if err := s.DeviceBelongsToWorkspace(ctx, deviceID, workspaceID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT id,device_id,code,name,type,unit,status FROM data_streams WHERE device_id=$1 AND status='active' ORDER BY type,name,code`, deviceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list open api data streams", err)
	}
	defer rows.Close()
	items := []OpenDataStream{}
	for rows.Next() {
		var item OpenDataStream
		if err = rows.Scan(&item.ID, &item.DeviceID, &item.Code, &item.Name, &item.Type, &item.Unit, &item.Status); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan open api data stream", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
