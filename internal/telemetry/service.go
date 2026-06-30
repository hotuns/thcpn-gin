package telemetry

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db/sqlc"
)

type TelemetryRuntime interface {
	QueryTelemetry(ctx context.Context, source datasource.DataSource, req datasource.TelemetryQuery) (datasource.TelemetryResult, error)
}

type Service struct {
	queries     *sqlc.Queries
	dataSources *datasource.Service
	runtime     TelemetryRuntime
	limits      config.QueryLimitsConfig
}

type QueryInput struct {
	DeviceID     *uuid.UUID
	DataStreamID *uuid.UUID
	StartTime    time.Time
	EndTime      time.Time
	Limit        int
}

type QueryResult struct {
	DeviceID  uuid.UUID `json:"device_id"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Limit     int       `json:"limit"`
	Series    []Series  `json:"series"`
}

type Series struct {
	DataStreamID uuid.UUID `json:"data_stream_id"`
	Code         string    `json:"code"`
	Name         string    `json:"name"`
	Unit         *string   `json:"unit,omitempty"`
	Points       []Point   `json:"points"`
}

type Point struct {
	Timestamp time.Time `json:"ts"`
	Value     float64   `json:"value"`
	Quality   string    `json:"quality"`
}

func NewService(db *pgxpool.Pool, dataSources *datasource.Service, runtime TelemetryRuntime, limits config.QueryLimitsConfig) *Service {
	if dataSources == nil {
		dataSources = datasource.NewService(db)
	}
	if runtime == nil {
		runtime = datasource.NewRuntime(nil)
	}
	return &Service{
		queries:     sqlc.New(db),
		dataSources: dataSources,
		runtime:     runtime,
		limits:      normalizeLimits(limits),
	}
}

func (s *Service) Query(ctx context.Context, input QueryInput) (QueryResult, error) {
	if input.DeviceID == nil && input.DataStreamID == nil {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "device_id or data_stream_id is required")
	}
	limit, err := normalizeLimit(input.Limit, s.limits)
	if err != nil {
		return QueryResult{}, err
	}
	if err := validateTimeRange(input.StartTime, input.EndTime, s.limits); err != nil {
		return QueryResult{}, err
	}

	if input.DataStreamID != nil {
		return s.queryDataStream(ctx, *input.DataStreamID, input.DeviceID, input.StartTime, input.EndTime, limit)
	}
	return s.queryDevice(ctx, *input.DeviceID, input.StartTime, input.EndTime, limit)
}

func (s *Service) queryDevice(ctx context.Context, deviceID uuid.UUID, start time.Time, end time.Time, limit int) (QueryResult, error) {
	if deviceID == uuid.Nil {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	device, err := s.queries.GetDevice(ctx, deviceID)
	if err != nil {
		return QueryResult{}, mapNotFoundOrInternal(err, "device not found")
	}
	streams, err := s.queries.ListDataStreamsByDevice(ctx, deviceID)
	if err != nil {
		return QueryResult{}, apperr.Wrap(apperr.KindInternal, "list data streams", err)
	}

	result := QueryResult{
		DeviceID:  device.ID,
		StartTime: start,
		EndTime:   end,
		Limit:     limit,
		Series:    make([]Series, 0),
	}
	for _, stream := range streams {
		if stream.Type != "telemetry" || stream.Status != "active" {
			continue
		}
		series, err := s.querySeries(ctx, stream, start, end, limit)
		if err != nil {
			return QueryResult{}, err
		}
		result.Series = append(result.Series, series)
	}
	return result, nil
}

func (s *Service) queryDataStream(ctx context.Context, dataStreamID uuid.UUID, deviceID *uuid.UUID, start time.Time, end time.Time, limit int) (QueryResult, error) {
	if dataStreamID == uuid.Nil {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "data stream id is required")
	}
	stream, err := s.queries.GetDataStream(ctx, dataStreamID)
	if err != nil {
		return QueryResult{}, mapNotFoundOrInternal(err, "data stream not found")
	}
	if deviceID != nil && *deviceID != stream.DeviceID {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "data stream does not belong to device")
	}
	if stream.Type != "telemetry" {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "data stream is not telemetry")
	}
	if stream.Status != "active" {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "data stream is not active")
	}

	series, err := s.querySeries(ctx, stream, start, end, limit)
	if err != nil {
		return QueryResult{}, err
	}
	return QueryResult{
		DeviceID:  stream.DeviceID,
		StartTime: start,
		EndTime:   end,
		Limit:     limit,
		Series:    []Series{series},
	}, nil
}

func (s *Service) querySeries(ctx context.Context, stream sqlc.DataStream, start time.Time, end time.Time, limit int) (Series, error) {
	binding, err := s.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
	if err != nil {
		return Series{}, err
	}
	source, err := s.dataSources.GetDataSource(ctx, binding.DataSourceID)
	if err != nil {
		return Series{}, err
	}
	points, err := s.runtime.QueryTelemetry(ctx, source, datasource.TelemetryQuery{
		Binding: binding,
		Start:   start,
		End:     end,
		Limit:   limit,
	})
	if err != nil {
		return Series{}, err
	}

	return Series{
		DataStreamID: stream.ID,
		Code:         stream.Code,
		Name:         stream.Name,
		Unit:         stream.Unit,
		Points:       pointsFromDatasource(points.Points),
	}, nil
}

func pointsFromDatasource(points []datasource.TelemetryPoint) []Point {
	items := make([]Point, 0, len(points))
	for _, point := range points {
		items = append(items, Point{
			Timestamp: point.Timestamp,
			Value:     point.Value,
			Quality:   point.Quality,
		})
	}
	return items
}

func normalizeLimits(limits config.QueryLimitsConfig) config.QueryLimitsConfig {
	if limits.MaxHistoryDays <= 0 {
		limits.MaxHistoryDays = 31
	}
	if limits.MaxPoints <= 0 {
		limits.MaxPoints = 5000
	}
	return limits
}

func normalizeLimit(limit int, limits config.QueryLimitsConfig) (int, error) {
	limits = normalizeLimits(limits)
	if limit == 0 {
		return limits.MaxPoints, nil
	}
	if limit < 0 {
		return 0, apperr.New(apperr.KindInvalidArgument, "limit must be greater than 0")
	}
	if limit > limits.MaxPoints {
		return 0, apperr.New(apperr.KindInvalidArgument, "limit exceeds max_points")
	}
	return limit, nil
}

func validateTimeRange(start time.Time, end time.Time, limits config.QueryLimitsConfig) error {
	limits = normalizeLimits(limits)
	if start.IsZero() {
		return apperr.New(apperr.KindInvalidArgument, "start_time is required")
	}
	if end.IsZero() {
		return apperr.New(apperr.KindInvalidArgument, "end_time is required")
	}
	if !end.After(start) {
		return apperr.New(apperr.KindInvalidArgument, "end_time must be after start_time")
	}
	maxRange := time.Duration(limits.MaxHistoryDays) * 24 * time.Hour
	if end.Sub(start) > maxRange {
		return apperr.New(apperr.KindInvalidArgument, "time range exceeds max_history_days")
	}
	return nil
}

func pgTime(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
}

func mapNotFoundOrInternal(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindNotFound, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
