package datastream

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
	queries *sqlc.Queries
	db      *pgxpool.Pool
}

const listComputedDataStreamIDsByDeviceQuery = `
	SELECT cds.data_stream_id
	FROM computed_data_streams cds
	JOIN data_streams ds ON ds.id = cds.data_stream_id
	WHERE ds.device_id = $1
`

type DataStream struct {
	ID        uuid.UUID `json:"id"`
	DeviceID  uuid.UUID `json:"device_id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Unit      *string   `json:"unit,omitempty"`
	Status    string    `json:"status"`
	CreatedBy uuid.UUID `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Computed  bool      `json:"computed"`
}

type CreateInput struct {
	DeviceID    uuid.UUID
	Code        string
	Name        string
	Type        string
	Unit        string
	ActorUserID uuid.UUID
}

type UpdateInput struct {
	DataStreamID uuid.UUID
	Code         *string
	Name         *string
	Type         *string
	Unit         *string
	Status       *string
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{queries: sqlc.New(db), db: db}
}

func (s *Service) WorkspaceForDevice(ctx context.Context, deviceID uuid.UUID) (uuid.UUID, error) {
	if deviceID == uuid.Nil {
		return uuid.Nil, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}

	assignment, err := s.queries.GetActiveDeviceAssignment(ctx, deviceID)
	if err != nil {
		return uuid.Nil, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	return assignment.WorkspaceID, nil
}

func (s *Service) Create(ctx context.Context, input CreateInput) (DataStream, error) {
	code := strings.TrimSpace(input.Code)
	name := strings.TrimSpace(input.Name)
	streamType := strings.TrimSpace(input.Type)
	if input.DeviceID == uuid.Nil {
		return DataStream{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return DataStream{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if code == "" {
		return DataStream{}, apperr.New(apperr.KindInvalidArgument, "data stream code is required")
	}
	if name == "" {
		return DataStream{}, apperr.New(apperr.KindInvalidArgument, "data stream name is required")
	}
	if !isValidDataStreamType(streamType) {
		return DataStream{}, apperr.New(apperr.KindInvalidArgument, "invalid data stream type")
	}

	created, err := s.queries.CreateDataStream(ctx, sqlc.CreateDataStreamParams{
		DeviceID:  input.DeviceID,
		Code:      code,
		Name:      name,
		Type:      streamType,
		Unit:      nullableTrimmedString(input.Unit),
		CreatedBy: input.ActorUserID,
	})
	if err != nil {
		return DataStream{}, mapWriteError(err, "create data stream")
	}

	return fromSQL(created), nil
}

func (s *Service) Get(ctx context.Context, dataStreamID uuid.UUID) (DataStream, error) {
	if dataStreamID == uuid.Nil {
		return DataStream{}, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}

	row, err := s.queries.GetDataStream(ctx, dataStreamID)
	if err != nil {
		return DataStream{}, mapNotFoundOrInternal(err, "data stream not found")
	}

	result := fromSQL(row)
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM computed_data_streams WHERE data_stream_id=$1)`, dataStreamID).Scan(&result.Computed); err != nil {
		return DataStream{}, apperr.Wrap(apperr.KindInternal, "read data stream kind", err)
	}
	return result, nil
}

func (s *Service) ListByDevice(ctx context.Context, deviceID uuid.UUID) ([]DataStream, error) {
	if deviceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}

	rows, err := s.queries.ListDataStreamsByDevice(ctx, deviceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list data streams", err)
	}

	computed := map[uuid.UUID]struct{}{}
	computedRows, err := s.db.Query(ctx, listComputedDataStreamIDsByDeviceQuery, deviceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list computed data stream ids", err)
	}
	for computedRows.Next() {
		var id uuid.UUID
		if err := computedRows.Scan(&id); err != nil {
			computedRows.Close()
			return nil, apperr.Wrap(apperr.KindInternal, "scan computed data stream id", err)
		}
		computed[id] = struct{}{}
	}
	computedRows.Close()
	items := make([]DataStream, 0, len(rows))
	for _, row := range rows {
		item := fromSQL(row)
		_, item.Computed = computed[item.ID]
		items = append(items, item)
	}
	return items, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (DataStream, error) {
	if input.DataStreamID == uuid.Nil {
		return DataStream{}, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}

	current, err := s.queries.GetDataStream(ctx, input.DataStreamID)
	if err != nil {
		return DataStream{}, mapNotFoundOrInternal(err, "data stream not found")
	}

	code := current.Code
	if input.Code != nil {
		code = strings.TrimSpace(*input.Code)
		if code == "" {
			return DataStream{}, apperr.New(apperr.KindInvalidArgument, "data stream code is required")
		}
	}

	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return DataStream{}, apperr.New(apperr.KindInvalidArgument, "data stream name is required")
		}
	}

	streamType := current.Type
	if input.Type != nil {
		streamType = strings.TrimSpace(*input.Type)
		if !isValidDataStreamType(streamType) {
			return DataStream{}, apperr.New(apperr.KindInvalidArgument, "invalid data stream type")
		}
	}

	unit := current.Unit
	if input.Unit != nil {
		unit = nullableTrimmedString(*input.Unit)
	}

	status := current.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if !isValidDataStreamStatus(status) {
			return DataStream{}, apperr.New(apperr.KindInvalidArgument, "invalid data stream status")
		}
	}

	updated, err := s.queries.UpdateDataStream(ctx, sqlc.UpdateDataStreamParams{
		ID:     input.DataStreamID,
		Code:   code,
		Name:   name,
		Type:   streamType,
		Unit:   unit,
		Status: status,
	})
	if err != nil {
		return DataStream{}, mapWriteError(err, "update data stream")
	}

	return fromSQL(updated), nil
}

func isValidDataStreamType(value string) bool {
	switch value {
	case "telemetry", "image", "video", "audio", "event", "log":
		return true
	default:
		return false
	}
}

func isValidDataStreamStatus(value string) bool {
	switch value {
	case "active", "disabled", "archived":
		return true
	default:
		return false
	}
}

func fromSQL(model sqlc.DataStream) DataStream {
	return DataStream{
		ID:        model.ID,
		DeviceID:  model.DeviceID,
		Code:      model.Code,
		Name:      model.Name,
		Type:      model.Type,
		Unit:      model.Unit,
		Status:    model.Status,
		CreatedBy: model.CreatedBy,
		CreatedAt: pgTime(model.CreatedAt),
		UpdatedAt: pgTime(model.UpdatedAt),
	}
}

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
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
