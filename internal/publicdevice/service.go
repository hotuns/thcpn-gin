package publicdevice

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
)

const publicWindow = 72 * time.Hour

type Service struct{ db *pgxpool.Pool }

type Publication struct {
	ID              uuid.UUID `json:"id"`
	DeviceID        uuid.UUID `json:"device_id"`
	WorkspaceID     uuid.UUID `json:"-"`
	PublicSlug      string    `json:"public_slug"`
	Enabled         bool      `json:"enabled"`
	PasswordEnabled bool      `json:"password_enabled"`
	AccessVersion   int       `json:"-"`
	UpdatedBy       uuid.UUID `json:"-"`
	UpdatedByName   *string   `json:"updated_by_name,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	PasswordHash    *string   `json:"-"`
}

type PublicDevice struct {
	PublicSlug     string       `json:"public_slug"`
	Name           string       `json:"name"`
	Status         string       `json:"status"`
	DeviceType     string       `json:"device_type"`
	TopologyRole   string       `json:"topology_role"`
	UpdatedAt      time.Time    `json:"updated_at"`
	PasswordNeeded bool         `json:"password_required"`
	AccessGranted  bool         `json:"access_granted"`
	Telemetry      []StreamInfo `json:"telemetry_streams,omitempty"`
	Images         []StreamInfo `json:"image_streams,omitempty"`
}

type StreamInfo struct {
	ID   uuid.UUID `json:"id"`
	Code string    `json:"code"`
	Name string    `json:"name"`
	Unit *string   `json:"unit,omitempty"`
}

type UpdateInput struct {
	DeviceID       uuid.UUID
	ActorID        uuid.UUID
	Enabled        bool
	PasswordEnable bool
	Password       string
}

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

func (s *Service) GetByDevice(ctx context.Context, deviceID uuid.UUID) (Publication, error) {
	var result Publication
	err := s.db.QueryRow(ctx, `
		SELECT p.id, p.device_id, a.workspace_id, p.public_slug, p.enabled,
			p.password_hash IS NOT NULL, p.access_version, p.updated_by, u.name,
			p.created_at, p.updated_at, p.password_hash
		FROM device_publications p
		JOIN devices d ON d.id = p.device_id
		JOIN device_assignments a ON a.device_id = d.id AND a.status = 'active'
		LEFT JOIN users u ON u.id = p.updated_by
		WHERE p.device_id = $1
	`, deviceID).Scan(&result.ID, &result.DeviceID, &result.WorkspaceID, &result.PublicSlug,
		&result.Enabled, &result.PasswordEnabled, &result.AccessVersion, &result.UpdatedBy,
		&result.UpdatedByName, &result.CreatedAt, &result.UpdatedAt, &result.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Publication{DeviceID: deviceID}, nil
	}
	if err != nil {
		return Publication{}, apperr.Wrap(apperr.KindInternal, "get device public access", err)
	}
	return result, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Publication, error) {
	if input.DeviceID == uuid.Nil || input.ActorID == uuid.Nil {
		return Publication{}, apperr.New(apperr.KindInvalidArgument, "device and actor are required")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Publication{}, apperr.Wrap(apperr.KindInternal, "begin public access update", err)
	}
	defer tx.Rollback(ctx)
	var workspaceID uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT a.workspace_id
		FROM devices d
		JOIN device_assignments a ON a.device_id = d.id AND a.status = 'active'
		WHERE d.id = $1
		FOR UPDATE OF d, a
	`, input.DeviceID).Scan(&workspaceID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Publication{}, apperr.New(apperr.KindNotFound, "device not found")
		}
		return Publication{}, apperr.Wrap(apperr.KindInternal, "get public device", err)
	}
	var id uuid.UUID
	var passwordHash *string
	var exists bool
	err = tx.QueryRow(ctx, `SELECT id, password_hash FROM device_publications WHERE device_id = $1 FOR UPDATE`, input.DeviceID).Scan(&id, &passwordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		exists = false
	} else if err != nil {
		return Publication{}, apperr.Wrap(apperr.KindInternal, "lock device publication", err)
	} else {
		exists = true
	}

	password := strings.TrimSpace(input.Password)
	if input.PasswordEnable && password == "" && passwordHash == nil {
		return Publication{}, apperr.New(apperr.KindInvalidArgument, "password is required when password protection is enabled")
	}
	if password != "" {
		if len(password) < 8 || len(password) > 72 {
			return Publication{}, apperr.New(apperr.KindInvalidArgument, "password must contain 8 to 72 characters")
		}
		hash, hashErr := auth.HashPassword(password)
		if hashErr != nil {
			return Publication{}, apperr.Wrap(apperr.KindInternal, "hash public access password", hashErr)
		}
		passwordHash = &hash
	}
	if !input.PasswordEnable {
		passwordHash = nil
	}

	if !exists {
		slug, slugErr := newSlug()
		if slugErr != nil {
			return Publication{}, apperr.Wrap(apperr.KindInternal, "generate public slug", slugErr)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO device_publications (device_id, public_slug, enabled, password_hash, created_by, updated_by)
			VALUES ($1, $2, $3, $4, $5, $5)
		`, input.DeviceID, slug, input.Enabled, passwordHash, input.ActorID)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE device_publications SET enabled = $2, password_hash = $3,
				access_version = access_version + 1, updated_by = $4, updated_at = now()
			WHERE device_id = $1
		`, input.DeviceID, input.Enabled, passwordHash, input.ActorID)
	}
	if err != nil {
		return Publication{}, apperr.Wrap(apperr.KindInternal, "update device public access", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Publication{}, apperr.Wrap(apperr.KindInternal, "commit public access update", err)
	}
	return s.GetByDevice(ctx, input.DeviceID)
}

func (s *Service) Resolve(ctx context.Context, slug string) (Publication, PublicDevice, error) {
	slug = strings.TrimSpace(slug)
	var publication Publication
	var device PublicDevice
	err := s.db.QueryRow(ctx, `
		SELECT p.id, p.device_id, a.workspace_id, p.public_slug, p.enabled,
			p.password_hash IS NOT NULL, p.access_version, p.password_hash,
			d.name, d.status, d.device_type, d.device_type, d.updated_at
		FROM device_publications p
		JOIN devices d ON d.id = p.device_id
		JOIN device_assignments a ON a.device_id = d.id AND a.status = 'active'
		WHERE p.public_slug = $1
	`, slug).Scan(&publication.ID, &publication.DeviceID, &publication.WorkspaceID,
		&publication.PublicSlug, &publication.Enabled, &publication.PasswordEnabled,
		&publication.AccessVersion, &publication.PasswordHash, &device.Name, &device.Status,
		&device.DeviceType, &device.TopologyRole, &device.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) || (!publication.Enabled || device.Status != "active") {
		return Publication{}, PublicDevice{}, apperr.New(apperr.KindNotFound, "public device is unavailable")
	}
	if err != nil {
		return Publication{}, PublicDevice{}, apperr.Wrap(apperr.KindInternal, "get public device", err)
	}
	device.PublicSlug = publication.PublicSlug
	device.PasswordNeeded = publication.PasswordEnabled
	return publication, device, nil
}

func (s *Service) LoadStreams(ctx context.Context, deviceID uuid.UUID) (telemetry []StreamInfo, images []StreamInfo, err error) {
	rows, err := s.db.Query(ctx, `SELECT id, code, name, unit, type FROM data_streams WHERE device_id = $1 AND status = 'active' AND type IN ('telemetry','image') ORDER BY type, name`, deviceID)
	if err != nil {
		return nil, nil, apperr.Wrap(apperr.KindInternal, "list public device streams", err)
	}
	defer rows.Close()
	for rows.Next() {
		var stream StreamInfo
		var streamType string
		if err := rows.Scan(&stream.ID, &stream.Code, &stream.Name, &stream.Unit, &streamType); err != nil {
			return nil, nil, apperr.Wrap(apperr.KindInternal, "scan public device stream", err)
		}
		if streamType == "telemetry" {
			telemetry = append(telemetry, stream)
		} else {
			images = append(images, stream)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, apperr.Wrap(apperr.KindInternal, "read public device streams", err)
	}
	return telemetry, images, nil
}

func (s *Service) CheckPassword(publication Publication, password string) bool {
	return publication.PasswordHash != nil && auth.CheckPassword(*publication.PasswordHash, password)
}

func Window(now time.Time) (time.Time, time.Time) { return now.Add(-publicWindow), now }

func newSlug() (string, error) {
	var value [24]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value[:]), nil
}
