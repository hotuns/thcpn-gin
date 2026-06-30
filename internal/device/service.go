package device

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

type Service struct {
	db      *pgxpool.Pool
	queries *sqlc.Queries
}

type Device struct {
	ID           uuid.UUID  `json:"id"`
	WorkspaceID  uuid.UUID  `json:"workspace_id"`
	ProjectID    *uuid.UUID `json:"project_id,omitempty"`
	SiteID       *uuid.UUID `json:"site_id,omitempty"`
	ProductID    *string    `json:"product_id,omitempty"`
	SerialNo     string     `json:"serial_no"`
	Name         string     `json:"name"`
	Status       string     `json:"status"`
	ActivatedAt  *time.Time `json:"activated_at,omitempty"`
	BoundBy      *uuid.UUID `json:"bound_by,omitempty"`
	Capabilities []string   `json:"capabilities"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type CreateInput struct {
	WorkspaceID  uuid.UUID
	ProjectID    *uuid.UUID
	SiteID       *uuid.UUID
	ProductID    string
	SerialNo     string
	Name         string
	Capabilities []string
	ActorUserID  uuid.UUID
}

type ListInput struct {
	WorkspaceID uuid.UUID
	ProjectID   *uuid.UUID
	SiteID      *uuid.UUID
}

type UpdateInput struct {
	DeviceID     uuid.UUID
	ProjectID    *uuid.UUID
	SiteID       *uuid.UUID
	ProductID    *string
	SerialNo     *string
	Name         *string
	Status       *string
	Capabilities *[]string
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		db:      db,
		queries: sqlc.New(db),
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Device, error) {
	serialNo := strings.TrimSpace(input.SerialNo)
	name := strings.TrimSpace(input.Name)
	if input.WorkspaceID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if input.SiteID != nil && input.ProjectID == nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}
	if serialNo == "" {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "serial_no is required")
	}
	if name == "" {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "device name is required")
	}
	capabilities, err := normalizeCapabilities(input.Capabilities)
	if err != nil {
		return Device{}, err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "begin create device transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	created, err := q.CreateDevice(ctx, sqlc.CreateDeviceParams{
		WorkspaceID: input.WorkspaceID,
		ProjectID:   input.ProjectID,
		SiteID:      input.SiteID,
		ProductID:   nullableTrimmedString(input.ProductID),
		SerialNo:    serialNo,
		Name:        name,
		BoundBy:     &input.ActorUserID,
	})
	if err != nil {
		return Device{}, mapWriteError(err, "create device")
	}

	if err := replaceCapabilities(ctx, q, created.ID, capabilities); err != nil {
		return Device{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "commit create device transaction", err)
	}
	committed = true

	return fromSQL(created, capabilities), nil
}

func (s *Service) Get(ctx context.Context, deviceID uuid.UUID) (Device, error) {
	if deviceID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}

	row, err := s.queries.GetDevice(ctx, deviceID)
	if err != nil {
		return Device{}, mapNotFoundOrInternal(err, "device not found")
	}
	capabilities, err := s.queries.ListDeviceCapabilities(ctx, deviceID)
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
	}

	return fromSQL(row, capabilities), nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]Device, error) {
	if input.WorkspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.SiteID != nil && input.ProjectID == nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}

	var (
		rows []sqlc.Device
		err  error
	)
	switch {
	case input.SiteID != nil:
		rows, err = s.queries.ListDevicesBySite(ctx, input.SiteID)
	case input.ProjectID != nil:
		rows, err = s.queries.ListDevicesByProject(ctx, input.ProjectID)
	default:
		rows, err = s.queries.ListDevicesByWorkspace(ctx, input.WorkspaceID)
	}
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list devices", err)
	}

	items := make([]Device, 0, len(rows))
	for _, row := range rows {
		if row.WorkspaceID != input.WorkspaceID {
			continue
		}
		capabilities, err := s.queries.ListDeviceCapabilities(ctx, row.ID)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
		}
		items = append(items, fromSQL(row, capabilities))
	}
	return items, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Device, error) {
	if input.DeviceID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}

	current, err := s.queries.GetDevice(ctx, input.DeviceID)
	if err != nil {
		return Device{}, mapNotFoundOrInternal(err, "device not found")
	}

	projectID := current.ProjectID
	if input.ProjectID != nil {
		projectID = input.ProjectID
	}
	siteID := current.SiteID
	if input.SiteID != nil {
		siteID = input.SiteID
	}
	if siteID != nil && projectID == nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}

	productID := current.ProductID
	if input.ProductID != nil {
		productID = nullableTrimmedString(*input.ProductID)
	}

	serialNo := current.SerialNo
	if input.SerialNo != nil {
		serialNo = strings.TrimSpace(*input.SerialNo)
		if serialNo == "" {
			return Device{}, apperr.New(apperr.KindInvalidArgument, "serial_no is required")
		}
	}

	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return Device{}, apperr.New(apperr.KindInvalidArgument, "device name is required")
		}
	}

	status := current.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if !isValidDeviceStatus(status) {
			return Device{}, apperr.New(apperr.KindInvalidArgument, "invalid device status")
		}
	}

	capabilities, err := s.queries.ListDeviceCapabilities(ctx, input.DeviceID)
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
	}
	if input.Capabilities != nil {
		capabilities, err = normalizeCapabilities(*input.Capabilities)
		if err != nil {
			return Device{}, err
		}
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "begin update device transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	updated, err := q.UpdateDevice(ctx, sqlc.UpdateDeviceParams{
		ID:        input.DeviceID,
		ProjectID: projectID,
		SiteID:    siteID,
		ProductID: productID,
		SerialNo:  serialNo,
		Name:      name,
		Status:    status,
	})
	if err != nil {
		return Device{}, mapWriteError(err, "update device")
	}

	if input.Capabilities != nil {
		if err := replaceCapabilities(ctx, q, input.DeviceID, capabilities); err != nil {
			return Device{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "commit update device transaction", err)
	}
	committed = true

	return fromSQL(updated, capabilities), nil
}

func isValidDeviceStatus(status string) bool {
	switch status {
	case "active", "disabled", "retired":
		return true
	default:
		return false
	}
}

func normalizeCapabilities(values []string) ([]string, error) {
	seen := map[string]struct{}{}
	capabilities := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if !isValidCapability(value) {
			return nil, apperr.New(apperr.KindInvalidArgument, "invalid device capability")
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		capabilities = append(capabilities, value)
	}
	return capabilities, nil
}

func isValidCapability(value string) bool {
	switch value {
	case "telemetry", "image_capture", "video_stream", "ptz_control", "remote_command", "configurable", "calibratable", "firmware_update", "edge_storage":
		return true
	default:
		return false
	}
}

func replaceCapabilities(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, capabilities []string) error {
	if err := q.DeleteDeviceCapabilities(ctx, deviceID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete device capabilities", err)
	}
	for _, capability := range capabilities {
		if _, err := q.AddDeviceCapability(ctx, sqlc.AddDeviceCapabilityParams{
			DeviceID:       deviceID,
			CapabilityCode: capability,
		}); err != nil {
			return mapWriteError(err, "add device capability")
		}
	}
	return nil
}

func fromSQL(model sqlc.Device, capabilities []string) Device {
	return Device{
		ID:           model.ID,
		WorkspaceID:  model.WorkspaceID,
		ProjectID:    model.ProjectID,
		SiteID:       model.SiteID,
		ProductID:    model.ProductID,
		SerialNo:     model.SerialNo,
		Name:         model.Name,
		Status:       model.Status,
		ActivatedAt:  pgTimePtr(model.ActivatedAt),
		BoundBy:      model.BoundBy,
		Capabilities: capabilities,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func pgTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
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
