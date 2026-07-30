package telemetry

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/computedstream"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db/sqlc"
)

type TelemetryRuntime interface {
	QueryTelemetry(ctx context.Context, source datasource.DataSource, req datasource.TelemetryQuery) (datasource.TelemetryResult, error)
}

type batchTelemetryRuntime interface {
	QueryTelemetryBatch(ctx context.Context, source datasource.DataSource, req datasource.TelemetryBatchQuery) (datasource.TelemetryBatchResult, error)
}

type Service struct {
	queries     *sqlc.Queries
	dataSources *datasource.Service
	runtime     TelemetryRuntime
	limits      config.QueryLimitsConfig
	computed    *computedstream.Service
}

type QueryInput struct {
	DeviceID      *uuid.UUID
	DataStreamID  *uuid.UUID
	DataStreamIDs []uuid.UUID
	StartTime     time.Time
	EndTime       time.Time
	Limit         int
	Adaptive      bool
	TargetPoints  int
}

type QueryResult struct {
	DeviceID  uuid.UUID `json:"device_id"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Limit     int       `json:"limit"`
	Series    []Series  `json:"series"`
}

type Series struct {
	DataStreamID  uuid.UUID `json:"data_stream_id"`
	Code          string    `json:"code"`
	Name          string    `json:"name"`
	Unit          *string   `json:"unit,omitempty"`
	Points        []Point   `json:"points"`
	Warnings      []Warning `json:"warnings,omitempty"`
	SourceCount   int       `json:"source_count"`
	ReturnedCount int       `json:"returned_count"`
	Sampled       bool      `json:"sampled"`
	Complete      bool      `json:"complete"`
}

type Point struct {
	Timestamp time.Time `json:"ts"`
	Value     float64   `json:"value"`
	Quality   string    `json:"quality"`
}

type Warning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Count   int    `json:"count,omitempty"`
}

func NewService(db *pgxpool.Pool, dataSources *datasource.Service, runtime TelemetryRuntime, limits config.QueryLimitsConfig, computedServices ...*computedstream.Service) *Service {
	if dataSources == nil {
		dataSources = datasource.NewService(db)
	}
	if runtime == nil {
		runtime = datasource.NewRuntime(nil)
	}
	var computedService *computedstream.Service
	if len(computedServices) > 0 {
		computedService = computedServices[0]
	}
	return &Service{
		queries:     sqlc.New(db),
		dataSources: dataSources,
		runtime:     runtime,
		limits:      normalizeLimits(limits),
		computed:    computedService,
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
	targetPoints, err := normalizeTargetPoints(input.TargetPoints, input.Adaptive, s.limits)
	if err != nil {
		return QueryResult{}, err
	}
	if err := validateTimeRange(input.StartTime, input.EndTime, s.limits); err != nil {
		return QueryResult{}, err
	}

	if input.DataStreamID != nil {
		return s.queryDataStream(ctx, *input.DataStreamID, input.DeviceID, input.StartTime, input.EndTime, limit, input.Adaptive, targetPoints)
	}
	return s.queryDevice(ctx, *input.DeviceID, input.DataStreamIDs, input.StartTime, input.EndTime, limit, input.Adaptive, targetPoints)
}

// QueryInternal is used by trusted background jobs that already enforce their
// own row and time limits.
func (s *Service) QueryInternal(ctx context.Context, input QueryInput) (QueryResult, error) {
	if input.DeviceID == nil && input.DataStreamID == nil {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "device_id or data_stream_id is required")
	}
	if input.Limit <= 0 {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "limit must be greater than 0")
	}
	if input.StartTime.IsZero() || !input.EndTime.After(input.StartTime) {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "valid start_time and end_time are required")
	}
	if input.DataStreamID != nil {
		return s.queryDataStream(ctx, *input.DataStreamID, input.DeviceID, input.StartTime, input.EndTime, input.Limit, false, 0)
	}
	return s.queryDevice(ctx, *input.DeviceID, input.DataStreamIDs, input.StartTime, input.EndTime, input.Limit, false, 0)
}

func (s *Service) queryDevice(ctx context.Context, deviceID uuid.UUID, requestedIDs []uuid.UUID, start time.Time, end time.Time, limit int, adaptive bool, targetPoints int) (QueryResult, error) {
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
	requested := make(map[uuid.UUID]struct{}, len(requestedIDs))
	for _, id := range requestedIDs {
		requested[id] = struct{}{}
	}
	filtering := len(requested) > 0
	selected := make([]sqlc.DataStream, 0, len(streams))
	for _, stream := range streams {
		if stream.Type != "telemetry" || stream.Status != "active" {
			continue
		}
		if filtering {
			if _, ok := requested[stream.ID]; !ok {
				continue
			}
			delete(requested, stream.ID)
		}
		selected = append(selected, stream)
	}
	if len(requested) > 0 {
		return QueryResult{}, apperr.New(apperr.KindInvalidArgument, "data_stream_ids contains a stream that is not active telemetry on this device")
	}
	result := QueryResult{DeviceID: device.ID, StartTime: start, EndTime: end, Limit: limit, Series: make([]Series, 0, len(selected))}
	series, err := s.querySelectedSeries(ctx, selected, streams, start, end, limit, adaptive, targetPoints)
	if err != nil {
		return QueryResult{}, err
	}
	result.Series = append(result.Series, series...)
	return result, nil
}

func (s *Service) queryDataStream(ctx context.Context, dataStreamID uuid.UUID, deviceID *uuid.UUID, start time.Time, end time.Time, limit int, adaptive bool, targetPoints int) (QueryResult, error) {
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
	if s.computed != nil {
		if definition, found, definitionErr := s.computed.Definition(ctx, stream.ID); definitionErr != nil {
			return QueryResult{}, definitionErr
		} else if found {
			series, computedErr := s.queryComputedSeries(ctx, definition, start, end, limit, adaptive, targetPoints)
			if computedErr != nil {
				return QueryResult{}, computedErr
			}
			return QueryResult{DeviceID: stream.DeviceID, StartTime: start, EndTime: end, Limit: limit, Series: []Series{series}}, nil
		}
	}

	series, err := s.querySeries(ctx, stream, start, end, limit, adaptive, targetPoints)
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

func (s *Service) querySelectedSeries(ctx context.Context, selected, all []sqlc.DataStream, start time.Time, end time.Time, limit int, adaptive bool, targetPoints int) ([]Series, error) {
	if s.computed == nil {
		return s.querySeriesBatch(ctx, selected, start, end, limit, adaptive, targetPoints)
	}
	definitions, err := s.computed.DefinitionMap(ctx, selectedDeviceID(selected, all))
	if err != nil {
		return nil, err
	}
	rawSelected := make([]sqlc.DataStream, 0, len(selected))
	for _, stream := range selected {
		if _, computed := definitions[stream.ID]; !computed {
			rawSelected = append(rawSelected, stream)
		}
	}
	rawSeries, err := s.querySeriesBatch(ctx, rawSelected, start, end, limit, adaptive, targetPoints)
	if err != nil {
		return nil, err
	}
	rawByID := make(map[uuid.UUID]Series, len(rawSeries))
	for _, series := range rawSeries {
		rawByID[series.DataStreamID] = series
	}
	result := make([]Series, 0, len(selected))
	for _, stream := range selected {
		definition, computed := definitions[stream.ID]
		if !computed {
			result = append(result, rawByID[stream.ID])
			continue
		}
		series, err := s.queryComputedSeriesWithStreams(ctx, definition, all, start, end, limit, adaptive, targetPoints)
		if err != nil {
			return nil, err
		}
		result = append(result, series)
	}
	return result, nil
}

func selectedDeviceID(selected, all []sqlc.DataStream) uuid.UUID {
	if len(selected) > 0 {
		return selected[0].DeviceID
	}
	if len(all) > 0 {
		return all[0].DeviceID
	}
	return uuid.Nil
}

func (s *Service) queryComputedSeries(ctx context.Context, definition computedstream.Definition, start time.Time, end time.Time, limit int, adaptive bool, targetPoints int) (Series, error) {
	streams, err := s.queries.ListDataStreamsByDevice(ctx, definition.DeviceID)
	if err != nil {
		return Series{}, apperr.Wrap(apperr.KindInternal, "list computed stream dependencies", err)
	}
	return s.queryComputedSeriesWithStreams(ctx, definition, streams, start, end, limit, adaptive, targetPoints)
}

func (s *Service) queryComputedSeriesWithStreams(ctx context.Context, definition computedstream.Definition, streams []sqlc.DataStream, start time.Time, end time.Time, limit int, adaptive bool, targetPoints int) (Series, error) {
	byCode := make(map[string]sqlc.DataStream, len(streams))
	for _, stream := range streams {
		byCode[stream.Code] = stream
	}
	dependencies := make([]sqlc.DataStream, 0, len(definition.ReferencedStreamCodes))
	for _, code := range definition.ReferencedStreamCodes {
		stream, ok := byCode[code]
		if !ok {
			return Series{}, apperr.New(apperr.KindInvalidArgument, "computed stream dependency is missing: "+code)
		}
		dependencies = append(dependencies, stream)
	}
	dependencySeries, err := s.querySeriesBatch(ctx, dependencies, start, end, limit, false, 0)
	if err != nil {
		return Series{}, err
	}
	metadata, err := s.computed.NumericMetadata(ctx, definition.DeviceID)
	if err != nil {
		return Series{}, err
	}
	expression, err := s.computed.CompileDefinition(definition)
	if err != nil {
		return Series{}, apperr.New(apperr.KindInvalidArgument, "computed stream formula is invalid")
	}
	pointsByCode := make(map[string]map[int64]Point, len(dependencySeries))
	for _, series := range dependencySeries {
		values := make(map[int64]Point, len(series.Points))
		for _, point := range series.Points {
			values[point.Timestamp.UnixNano()] = point
		}
		pointsByCode[series.Code] = values
	}
	primary := dependencySeries[0]
	points := make([]Point, 0, len(primary.Points))
	missing, invalid := 0, 0
	for _, primaryPoint := range primary.Points {
		values := make(map[string]float64, len(dependencySeries))
		complete := true
		for _, series := range dependencySeries {
			point, ok := pointsByCode[series.Code][primaryPoint.Timestamp.UnixNano()]
			if !ok {
				complete = false
				break
			}
			values[series.Code] = point.Value
		}
		if !complete {
			missing++
			continue
		}
		value, evaluateErr := expression.Evaluate(values, metadata)
		if evaluateErr != nil {
			invalid++
			continue
		}
		points = append(points, Point{Timestamp: primaryPoint.Timestamp, Value: value, Quality: "calculated"})
	}
	sourceCount := len(points)
	if adaptive && targetPoints > 1 && len(points) > targetPoints {
		points = evenlySamplePoints(points, targetPoints)
	}
	if len(points) > limit {
		points = points[len(points)-limit:]
	}
	warnings := make([]Warning, 0, 2)
	if missing > 0 {
		warnings = append(warnings, Warning{Code: "computed_input_missing", Message: "computed points skipped because an input was missing", Count: missing})
	}
	if invalid > 0 {
		warnings = append(warnings, Warning{Code: "computed_evaluation_failed", Message: "computed points skipped because evaluation failed", Count: invalid})
	}
	return Series{
		DataStreamID: definition.DataStreamID, Code: definition.Code, Name: definition.Name, Unit: definition.Unit,
		Points: points, Warnings: warnings, SourceCount: sourceCount, ReturnedCount: len(points),
		Sampled: len(points) < sourceCount, Complete: missing == 0 && invalid == 0,
	}, nil
}

func evenlySamplePoints(points []Point, target int) []Point {
	if target >= len(points) {
		return points
	}
	result := make([]Point, 0, target)
	for index := 0; index < target; index++ {
		sourceIndex := index * (len(points) - 1) / (target - 1)
		result = append(result, points[sourceIndex])
	}
	return result
}

func (s *Service) querySeries(ctx context.Context, stream sqlc.DataStream, start time.Time, end time.Time, limit int, adaptive bool, targetPoints int) (Series, error) {
	binding, err := s.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
	if err != nil {
		return Series{}, err
	}
	source, err := s.dataSources.GetDataSource(ctx, binding.DataSourceID)
	if err != nil {
		return Series{}, err
	}
	points, err := s.runtime.QueryTelemetry(ctx, source, datasource.TelemetryQuery{
		Binding:      binding,
		Start:        start,
		End:          end,
		Limit:        limit,
		Adaptive:     adaptive,
		TargetPoints: targetPoints,
	})
	if err != nil {
		return Series{}, err
	}

	return seriesFromDatasource(stream, points), nil
}

func (s *Service) querySeriesBatch(ctx context.Context, streams []sqlc.DataStream, start time.Time, end time.Time, limit int, adaptive bool, targetPoints int) ([]Series, error) {
	batchRuntime, supportsBatch := s.runtime.(batchTelemetryRuntime)
	if !supportsBatch {
		items := make([]Series, 0, len(streams))
		for _, stream := range streams {
			series, err := s.querySeries(ctx, stream, start, end, limit, adaptive, targetPoints)
			if err != nil {
				return nil, err
			}
			items = append(items, series)
		}
		return items, nil
	}
	type sourceGroup struct {
		source   datasource.DataSource
		streams  []sqlc.DataStream
		bindings []datasource.DataStreamBinding
	}
	groups := make(map[uuid.UUID]*sourceGroup)
	for _, stream := range streams {
		binding, err := s.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
		if err != nil {
			return nil, err
		}
		group := groups[binding.DataSourceID]
		if group == nil {
			source, sourceErr := s.dataSources.GetDataSource(ctx, binding.DataSourceID)
			if sourceErr != nil {
				return nil, sourceErr
			}
			group = &sourceGroup{source: source}
			groups[binding.DataSourceID] = group
		}
		group.streams = append(group.streams, stream)
		group.bindings = append(group.bindings, binding)
	}
	results := make(map[uuid.UUID]datasource.TelemetryResult, len(streams))
	for _, group := range groups {
		batch, err := batchRuntime.QueryTelemetryBatch(ctx, group.source, datasource.TelemetryBatchQuery{
			Bindings: group.bindings, Start: start, End: end, Limit: limit, Adaptive: adaptive, TargetPoints: targetPoints,
		})
		if err != nil {
			return nil, err
		}
		for id, result := range batch.Series {
			results[id] = result
		}
	}
	items := make([]Series, 0, len(streams))
	for _, stream := range streams {
		points, ok := results[stream.ID]
		if !ok {
			return nil, apperr.New(apperr.KindDataSource, "batch telemetry result is missing a data stream")
		}
		items = append(items, seriesFromDatasource(stream, points))
	}
	return items, nil
}

func seriesFromDatasource(stream sqlc.DataStream, points datasource.TelemetryResult) Series {
	sourceCount := points.SourceCount
	if sourceCount == 0 && len(points.Points) > 0 {
		sourceCount = len(points.Points)
	}
	return Series{
		DataStreamID:  stream.ID,
		Code:          stream.Code,
		Name:          stream.Name,
		Unit:          stream.Unit,
		Points:        pointsFromDatasource(points.Points),
		Warnings:      warningsFromDatasource(points.Warnings),
		SourceCount:   sourceCount,
		ReturnedCount: len(points.Points),
		Sampled:       points.Sampled,
		Complete:      points.Complete,
	}
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

func warningsFromDatasource(warnings []datasource.QueryWarning) []Warning {
	items := make([]Warning, 0, len(warnings))
	for _, warning := range warnings {
		items = append(items, Warning{
			Code:    warning.Code,
			Message: warning.Message,
			Count:   warning.Count,
		})
	}
	return items
}

func normalizeLimits(limits config.QueryLimitsConfig) config.QueryLimitsConfig {
	if limits.MaxHistoryDays <= 0 {
		limits.MaxHistoryDays = 366
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

func normalizeTargetPoints(targetPoints int, adaptive bool, limits config.QueryLimitsConfig) (int, error) {
	if !adaptive {
		return 0, nil
	}
	limits = normalizeLimits(limits)
	if targetPoints == 0 {
		return 1000, nil
	}
	if targetPoints < 2 {
		return 0, apperr.New(apperr.KindInvalidArgument, "target_points must be at least 2")
	}
	if targetPoints > limits.MaxPoints {
		return 0, apperr.New(apperr.KindInvalidArgument, "target_points exceeds max_points")
	}
	return targetPoints, nil
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
		return apperr.New(
			apperr.KindInvalidArgument,
			fmt.Sprintf("time range cannot exceed %d days", limits.MaxHistoryDays),
		)
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
