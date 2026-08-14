package openapiaccess

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
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
}
type APIKey struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspace_id"`
	Name        string     `json:"name"`
	KeyPrefix   string     `json:"key_prefix"`
	CreatedBy   uuid.UUID  `json:"created_by"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	LastUsedAt  *time.Time `json:"last_used_at,omitempty"`
	RevokedAt   *time.Time `json:"revoked_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}
type CreatedAPIKey struct {
	APIKey
	Secret string `json:"secret"`
}

func NewService(db *pgxpool.Pool, billingService *billing.Service) *Service {
	return &Service{db: db, billing: billingService}
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
	rows, err := s.db.Query(ctx, `SELECT id,workspace_id,name,key_prefix,created_by,expires_at,last_used_at,revoked_at,created_at FROM workspace_api_keys WHERE workspace_id=$1 ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list api keys", err)
	}
	defer rows.Close()
	items := []APIKey{}
	for rows.Next() {
		var item APIKey
		if err = rows.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.KeyPrefix, &item.CreatedBy, &item.ExpiresAt, &item.LastUsedAt, &item.RevokedAt, &item.CreatedAt); err != nil {
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
	_, _ = s.db.Exec(ctx, `UPDATE workspace_api_keys SET last_used_at=now(),updated_at=now() WHERE id=$1`, item.ID)
	return item, nil
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
