package dataset

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
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db/sqlc"
)

type Service struct {
	db          *pgxpool.Pool
	queries     *sqlc.Queries
	dataSources *datasource.Service
	runtime     TelemetryRuntime
	limits      config.QueryLimitsConfig
}

type TelemetryRuntime interface {
	QueryTelemetry(ctx context.Context, source datasource.DataSource, req datasource.TelemetryQuery) (datasource.TelemetryResult, error)
}

type QueryDependencies struct {
	DataSources *datasource.Service
	Runtime     TelemetryRuntime
	Limits      config.QueryLimitsConfig
}

type Dataset struct {
	ID          uuid.UUID       `json:"id"`
	WorkspaceID uuid.UUID       `json:"workspace_id"`
	ProjectID   *uuid.UUID      `json:"project_id,omitempty"`
	Name        string          `json:"name"`
	Description *string         `json:"description,omitempty"`
	DataType    string          `json:"data_type"`
	TimeStart   time.Time       `json:"time_start"`
	TimeEnd     time.Time       `json:"time_end"`
	Status      string          `json:"status"`
	CreatedBy   uuid.UUID       `json:"created_by"`
	Sources     []DatasetSource `json:"sources"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type DatasetSource struct {
	ID         uuid.UUID `json:"id"`
	DatasetID  uuid.UUID `json:"dataset_id"`
	SourceType string    `json:"source_type"`
	SourceID   uuid.UUID `json:"source_id"`
	CreatedAt  time.Time `json:"created_at"`
}

type TelemetryQueryInput struct {
	DatasetID uuid.UUID
	StartTime time.Time
	EndTime   time.Time
	Limit     int
}

type TelemetryQueryResult struct {
	DatasetID   uuid.UUID         `json:"dataset_id"`
	WorkspaceID uuid.UUID         `json:"workspace_id"`
	StartTime   time.Time         `json:"start_time"`
	EndTime     time.Time         `json:"end_time"`
	Limit       int               `json:"limit"`
	Series      []TelemetrySeries `json:"series"`
}

type TelemetrySeries struct {
	SourceType   string           `json:"source_type"`
	SourceID     uuid.UUID        `json:"source_id"`
	DataStreamID uuid.UUID        `json:"data_stream_id"`
	DeviceID     uuid.UUID        `json:"device_id"`
	Code         string           `json:"code"`
	Name         string           `json:"name"`
	Unit         *string          `json:"unit,omitempty"`
	Points       []TelemetryPoint `json:"points"`
	Warnings     []Warning        `json:"warnings,omitempty"`
}

type TelemetryPoint struct {
	Timestamp time.Time `json:"ts"`
	Value     float64   `json:"value"`
	Quality   string    `json:"quality"`
}

type Warning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Count   int    `json:"count,omitempty"`
}

type SourceInput struct {
	SourceType string
	SourceID   uuid.UUID
}

type CreateInput struct {
	WorkspaceID uuid.UUID
	ProjectID   *uuid.UUID
	Name        string
	Description string
	DataType    string
	TimeStart   time.Time
	TimeEnd     time.Time
	Sources     []SourceInput
	ActorUserID uuid.UUID
}

type ListInput struct {
	WorkspaceID uuid.UUID
	ProjectID   *uuid.UUID
}

type UpdateInput struct {
	DatasetID   uuid.UUID
	Name        *string
	Description *string
	DataType    *string
	TimeStart   *time.Time
	TimeEnd     *time.Time
	Status      *string
	Sources     *[]SourceInput
}

func NewService(db *pgxpool.Pool, queryDeps ...QueryDependencies) *Service {
	var deps QueryDependencies
	if len(queryDeps) > 0 {
		deps = queryDeps[0]
	}
	if deps.DataSources == nil {
		deps.DataSources = datasource.NewService(db)
	}
	if deps.Runtime == nil {
		deps.Runtime = datasource.NewRuntime(nil)
	}
	return &Service{
		db:          db,
		queries:     sqlc.New(db),
		dataSources: deps.DataSources,
		runtime:     deps.Runtime,
		limits:      normalizeQueryLimits(deps.Limits),
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Dataset, error) {
	name := strings.TrimSpace(input.Name)
	dataType := strings.TrimSpace(input.DataType)
	if input.WorkspaceID == uuid.Nil {
		return Dataset{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return Dataset{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if name == "" {
		return Dataset{}, apperr.New(apperr.KindInvalidArgument, "dataset name is required")
	}
	if !isValidDataType(dataType) {
		return Dataset{}, apperr.New(apperr.KindInvalidArgument, "invalid dataset data_type")
	}
	if err := validateTimeRange(input.TimeStart, input.TimeEnd); err != nil {
		return Dataset{}, err
	}
	sources, err := normalizeSources(input.Sources)
	if err != nil {
		return Dataset{}, err
	}
	if len(sources) == 0 {
		return Dataset{}, apperr.New(apperr.KindInvalidArgument, "dataset sources are required")
	}
	if err := s.validateProject(ctx, input.WorkspaceID, input.ProjectID); err != nil {
		return Dataset{}, err
	}
	if err := s.validateSources(ctx, input.WorkspaceID, input.ProjectID, sources); err != nil {
		return Dataset{}, err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Dataset{}, apperr.Wrap(apperr.KindInternal, "begin create dataset transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	created, err := q.CreateDataset(ctx, sqlc.CreateDatasetParams{
		WorkspaceID: input.WorkspaceID,
		ProjectID:   input.ProjectID,
		Name:        name,
		Description: nullableTrimmedString(input.Description),
		DataType:    dataType,
		TimeStart:   pgTime(input.TimeStart),
		TimeEnd:     pgTime(input.TimeEnd),
		CreatedBy:   input.ActorUserID,
	})
	if err != nil {
		return Dataset{}, mapWriteError(err, "create dataset")
	}
	createdSources, err := replaceSources(ctx, q, created.ID, sources)
	if err != nil {
		return Dataset{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Dataset{}, apperr.Wrap(apperr.KindInternal, "commit create dataset transaction", err)
	}
	committed = true

	return datasetFromSQL(created, createdSources), nil
}

func (s *Service) Get(ctx context.Context, datasetID uuid.UUID) (Dataset, error) {
	if datasetID == uuid.Nil {
		return Dataset{}, apperr.New(apperr.KindInvalidArgument, "dataset id is required")
	}

	row, err := s.queries.GetDataset(ctx, datasetID)
	if err != nil {
		return Dataset{}, mapNotFoundOrInternal(err, "dataset not found")
	}
	sources, err := s.queries.ListDatasetSources(ctx, datasetID)
	if err != nil {
		return Dataset{}, apperr.Wrap(apperr.KindInternal, "list dataset sources", err)
	}
	return datasetFromSQL(row, sources), nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]Dataset, error) {
	if input.WorkspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}

	var (
		rows []sqlc.Dataset
		err  error
	)
	if input.ProjectID != nil {
		rows, err = s.queries.ListDatasetsByProject(ctx, input.ProjectID)
	} else {
		rows, err = s.queries.ListDatasetsByWorkspace(ctx, input.WorkspaceID)
	}
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list datasets", err)
	}

	items := make([]Dataset, 0, len(rows))
	for _, row := range rows {
		if row.WorkspaceID != input.WorkspaceID {
			continue
		}
		sources, err := s.queries.ListDatasetSources(ctx, row.ID)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "list dataset sources", err)
		}
		items = append(items, datasetFromSQL(row, sources))
	}
	return items, nil
}

func (s *Service) QueryTelemetry(ctx context.Context, input TelemetryQueryInput) (TelemetryQueryResult, error) {
	if input.DatasetID == uuid.Nil {
		return TelemetryQueryResult{}, apperr.New(apperr.KindInvalidArgument, "dataset id is required")
	}
	if s.dataSources == nil || s.runtime == nil {
		return TelemetryQueryResult{}, apperr.New(apperr.KindInternal, "dataset telemetry query is not configured")
	}

	dataset, err := s.queries.GetDataset(ctx, input.DatasetID)
	if err != nil {
		return TelemetryQueryResult{}, mapNotFoundOrInternal(err, "dataset not found")
	}
	if dataset.DataType != "telemetry" && dataset.DataType != "mixed" {
		return TelemetryQueryResult{}, apperr.New(apperr.KindInvalidArgument, "dataset does not contain telemetry data")
	}
	sources, err := s.queries.ListDatasetSources(ctx, input.DatasetID)
	if err != nil {
		return TelemetryQueryResult{}, apperr.Wrap(apperr.KindInternal, "list dataset sources", err)
	}

	start, end, err := resolveTelemetryQueryRange(pgTimeValue(dataset.TimeStart), pgTimeValue(dataset.TimeEnd), input.StartTime, input.EndTime, s.limits)
	if err != nil {
		return TelemetryQueryResult{}, err
	}
	limit, err := normalizeTelemetryQueryLimit(input.Limit, s.limits)
	if err != nil {
		return TelemetryQueryResult{}, err
	}

	series := make([]TelemetrySeries, 0)
	for _, source := range sources {
		sourceSeries, err := s.queryTelemetrySource(ctx, source, start, end, limit)
		if err != nil {
			return TelemetryQueryResult{}, err
		}
		series = append(series, sourceSeries...)
	}

	return TelemetryQueryResult{
		DatasetID:   dataset.ID,
		WorkspaceID: dataset.WorkspaceID,
		StartTime:   start,
		EndTime:     end,
		Limit:       limit,
		Series:      series,
	}, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Dataset, error) {
	if input.DatasetID == uuid.Nil {
		return Dataset{}, apperr.New(apperr.KindInvalidArgument, "dataset id is required")
	}

	current, err := s.queries.GetDataset(ctx, input.DatasetID)
	if err != nil {
		return Dataset{}, mapNotFoundOrInternal(err, "dataset not found")
	}

	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return Dataset{}, apperr.New(apperr.KindInvalidArgument, "dataset name is required")
		}
	}

	description := current.Description
	if input.Description != nil {
		description = nullableTrimmedString(*input.Description)
	}

	dataType := current.DataType
	if input.DataType != nil {
		dataType = strings.TrimSpace(*input.DataType)
		if !isValidDataType(dataType) {
			return Dataset{}, apperr.New(apperr.KindInvalidArgument, "invalid dataset data_type")
		}
	}

	timeStart := pgTimeValue(current.TimeStart)
	if input.TimeStart != nil {
		timeStart = *input.TimeStart
	}
	timeEnd := pgTimeValue(current.TimeEnd)
	if input.TimeEnd != nil {
		timeEnd = *input.TimeEnd
	}
	if err := validateTimeRange(timeStart, timeEnd); err != nil {
		return Dataset{}, err
	}

	status := current.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if !isValidStatus(status) {
			return Dataset{}, apperr.New(apperr.KindInvalidArgument, "invalid dataset status")
		}
	}

	sources, err := s.queries.ListDatasetSources(ctx, input.DatasetID)
	if err != nil {
		return Dataset{}, apperr.Wrap(apperr.KindInternal, "list dataset sources", err)
	}
	sourceInputs := sourcesToInputs(sources)
	if input.Sources != nil {
		sourceInputs, err = normalizeSources(*input.Sources)
		if err != nil {
			return Dataset{}, err
		}
		if len(sourceInputs) == 0 {
			return Dataset{}, apperr.New(apperr.KindInvalidArgument, "dataset sources are required")
		}
	}
	if err := s.validateSources(ctx, current.WorkspaceID, current.ProjectID, sourceInputs); err != nil {
		return Dataset{}, err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Dataset{}, apperr.Wrap(apperr.KindInternal, "begin update dataset transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	updated, err := q.UpdateDataset(ctx, sqlc.UpdateDatasetParams{
		ID:          input.DatasetID,
		Name:        name,
		Description: description,
		DataType:    dataType,
		TimeStart:   pgTime(timeStart),
		TimeEnd:     pgTime(timeEnd),
		Status:      status,
	})
	if err != nil {
		return Dataset{}, mapWriteError(err, "update dataset")
	}

	if input.Sources != nil {
		sources, err = replaceSources(ctx, q, input.DatasetID, sourceInputs)
		if err != nil {
			return Dataset{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Dataset{}, apperr.Wrap(apperr.KindInternal, "commit update dataset transaction", err)
	}
	committed = true

	return datasetFromSQL(updated, sources), nil
}

func (s *Service) Delete(ctx context.Context, datasetID uuid.UUID) (Dataset, error) {
	if datasetID == uuid.Nil {
		return Dataset{}, apperr.New(apperr.KindInvalidArgument, "dataset id is required")
	}
	sources, err := s.queries.ListDatasetSources(ctx, datasetID)
	if err != nil {
		return Dataset{}, apperr.Wrap(apperr.KindInternal, "list dataset sources", err)
	}
	deleted, err := s.queries.DeleteDataset(ctx, datasetID)
	if err != nil {
		return Dataset{}, mapNotFoundOrInternal(err, "dataset not found")
	}
	return datasetFromSQL(deleted, sources), nil
}

func (s *Service) queryTelemetrySource(ctx context.Context, source sqlc.DatasetSource, start time.Time, end time.Time, limit int) ([]TelemetrySeries, error) {
	switch source.SourceType {
	case "device":
		device, err := s.queries.GetDevice(ctx, source.SourceID)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "device source not found")
		}
		streams, err := s.queries.ListDataStreamsByDevice(ctx, device.ID)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "list data streams", err)
		}
		series := make([]TelemetrySeries, 0)
		for _, stream := range streams {
			if stream.Type != "telemetry" || stream.Status != "active" {
				continue
			}
			item, err := s.queryTelemetrySeries(ctx, source.SourceType, source.SourceID, stream, start, end, limit)
			if err != nil {
				return nil, err
			}
			series = append(series, item)
		}
		return series, nil
	case "data_stream":
		stream, err := s.queries.GetDataStream(ctx, source.SourceID)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "data stream source not found")
		}
		if stream.Type != "telemetry" {
			return nil, nil
		}
		if stream.Status != "active" {
			return nil, apperr.New(apperr.KindInvalidArgument, "data stream is not active")
		}
		item, err := s.queryTelemetrySeries(ctx, source.SourceType, source.SourceID, stream, start, end, limit)
		if err != nil {
			return nil, err
		}
		return []TelemetrySeries{item}, nil
	case "file":
		return nil, nil
	default:
		return nil, apperr.New(apperr.KindInvalidArgument, "invalid dataset source_type")
	}
}

func (s *Service) queryTelemetrySeries(ctx context.Context, sourceType string, sourceID uuid.UUID, stream sqlc.DataStream, start time.Time, end time.Time, limit int) (TelemetrySeries, error) {
	binding, err := s.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
	if err != nil {
		return TelemetrySeries{}, err
	}
	source, err := s.dataSources.GetDataSource(ctx, binding.DataSourceID)
	if err != nil {
		return TelemetrySeries{}, err
	}
	result, err := s.runtime.QueryTelemetry(ctx, source, datasource.TelemetryQuery{
		Binding: binding,
		Start:   start,
		End:     end,
		Limit:   limit,
	})
	if err != nil {
		return TelemetrySeries{}, err
	}

	return TelemetrySeries{
		SourceType:   sourceType,
		SourceID:     sourceID,
		DataStreamID: stream.ID,
		DeviceID:     stream.DeviceID,
		Code:         stream.Code,
		Name:         stream.Name,
		Unit:         stream.Unit,
		Points:       telemetryPointsFromDatasource(result.Points),
		Warnings:     warningsFromDatasource(result.Warnings),
	}, nil
}

func (s *Service) validateProject(ctx context.Context, workspaceID uuid.UUID, projectID *uuid.UUID) error {
	if projectID == nil {
		return nil
	}
	project, err := s.queries.GetProject(ctx, *projectID)
	if err != nil {
		return mapNotFoundOrInternal(err, "project not found")
	}
	if project.WorkspaceID != workspaceID {
		return apperr.New(apperr.KindInvalidArgument, "project does not belong to workspace")
	}
	return nil
}

func (s *Service) validateSources(ctx context.Context, workspaceID uuid.UUID, projectID *uuid.UUID, sources []SourceInput) error {
	for _, source := range sources {
		switch source.SourceType {
		case "device":
			device, err := s.queries.GetDevice(ctx, source.SourceID)
			if err != nil {
				return mapNotFoundOrInternal(err, "device source not found")
			}
			if device.WorkspaceID != workspaceID {
				return apperr.New(apperr.KindInvalidArgument, "device source does not belong to workspace")
			}
			if projectID != nil && (device.ProjectID == nil || *device.ProjectID != *projectID) {
				return apperr.New(apperr.KindInvalidArgument, "device source does not belong to dataset project")
			}
		case "data_stream":
			stream, err := s.queries.GetDataStream(ctx, source.SourceID)
			if err != nil {
				return mapNotFoundOrInternal(err, "data stream source not found")
			}
			if stream.WorkspaceID != workspaceID {
				return apperr.New(apperr.KindInvalidArgument, "data stream source does not belong to workspace")
			}
			if projectID != nil {
				device, err := s.queries.GetDevice(ctx, stream.DeviceID)
				if err != nil {
					return mapNotFoundOrInternal(err, "device source not found")
				}
				if device.ProjectID == nil || *device.ProjectID != *projectID {
					return apperr.New(apperr.KindInvalidArgument, "data stream source does not belong to dataset project")
				}
			}
		case "file":
			continue
		default:
			return apperr.New(apperr.KindInvalidArgument, "invalid dataset source_type")
		}
	}
	return nil
}

func normalizeSources(values []SourceInput) ([]SourceInput, error) {
	seen := map[string]struct{}{}
	sources := make([]SourceInput, 0, len(values))
	for _, value := range values {
		sourceType := strings.TrimSpace(value.SourceType)
		if sourceType == "" || value.SourceID == uuid.Nil {
			return nil, apperr.New(apperr.KindInvalidArgument, "dataset source_type and source_id are required")
		}
		if !isValidSourceType(sourceType) {
			return nil, apperr.New(apperr.KindInvalidArgument, "invalid dataset source_type")
		}
		key := sourceType + ":" + value.SourceID.String()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		sources = append(sources, SourceInput{SourceType: sourceType, SourceID: value.SourceID})
	}
	return sources, nil
}

func replaceSources(ctx context.Context, q *sqlc.Queries, datasetID uuid.UUID, sources []SourceInput) ([]sqlc.DatasetSource, error) {
	if err := q.DeleteDatasetSources(ctx, datasetID); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "delete dataset sources", err)
	}
	createdSources := make([]sqlc.DatasetSource, 0, len(sources))
	for _, source := range sources {
		created, err := q.CreateDatasetSource(ctx, sqlc.CreateDatasetSourceParams{
			DatasetID:  datasetID,
			SourceType: source.SourceType,
			SourceID:   source.SourceID,
		})
		if err != nil {
			return nil, mapWriteError(err, "create dataset source")
		}
		createdSources = append(createdSources, created)
	}
	return createdSources, nil
}

func sourcesToInputs(sources []sqlc.DatasetSource) []SourceInput {
	items := make([]SourceInput, 0, len(sources))
	for _, source := range sources {
		items = append(items, SourceInput{SourceType: source.SourceType, SourceID: source.SourceID})
	}
	return items
}

func isValidDataType(value string) bool {
	switch value {
	case "telemetry", "image", "video", "audio", "event", "log", "mixed":
		return true
	default:
		return false
	}
}

func isValidSourceType(value string) bool {
	switch value {
	case "device", "data_stream", "file":
		return true
	default:
		return false
	}
}

func isValidStatus(value string) bool {
	switch value {
	case "draft", "locked", "archived", "published":
		return true
	default:
		return false
	}
}

func validateTimeRange(start time.Time, end time.Time) error {
	if start.IsZero() {
		return apperr.New(apperr.KindInvalidArgument, "time_start is required")
	}
	if end.IsZero() {
		return apperr.New(apperr.KindInvalidArgument, "time_end is required")
	}
	if !end.After(start) {
		return apperr.New(apperr.KindInvalidArgument, "time_end must be after time_start")
	}
	return nil
}

func normalizeQueryLimits(limits config.QueryLimitsConfig) config.QueryLimitsConfig {
	if limits.MaxHistoryDays <= 0 {
		limits.MaxHistoryDays = 31
	}
	if limits.MaxPoints <= 0 {
		limits.MaxPoints = 5000
	}
	return limits
}

func normalizeTelemetryQueryLimit(limit int, limits config.QueryLimitsConfig) (int, error) {
	limits = normalizeQueryLimits(limits)
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

func resolveTelemetryQueryRange(datasetStart time.Time, datasetEnd time.Time, inputStart time.Time, inputEnd time.Time, limits config.QueryLimitsConfig) (time.Time, time.Time, error) {
	start := inputStart
	if start.IsZero() {
		start = datasetStart
	}
	end := inputEnd
	if end.IsZero() {
		end = datasetEnd
	}
	if start.IsZero() || end.IsZero() {
		return time.Time{}, time.Time{}, apperr.New(apperr.KindInvalidArgument, "dataset time range is required")
	}
	if !end.After(start) {
		return time.Time{}, time.Time{}, apperr.New(apperr.KindInvalidArgument, "end_time must be after start_time")
	}
	if !datasetStart.IsZero() && start.Before(datasetStart) {
		return time.Time{}, time.Time{}, apperr.New(apperr.KindInvalidArgument, "start_time is outside dataset time range")
	}
	if !datasetEnd.IsZero() && end.After(datasetEnd) {
		return time.Time{}, time.Time{}, apperr.New(apperr.KindInvalidArgument, "end_time is outside dataset time range")
	}

	limits = normalizeQueryLimits(limits)
	maxRange := time.Duration(limits.MaxHistoryDays) * 24 * time.Hour
	if end.Sub(start) > maxRange {
		return time.Time{}, time.Time{}, apperr.New(apperr.KindInvalidArgument, "time range exceeds max_history_days; use dataset export")
	}
	return start, end, nil
}

func datasetFromSQL(model sqlc.Dataset, sources []sqlc.DatasetSource) Dataset {
	return Dataset{
		ID:          model.ID,
		WorkspaceID: model.WorkspaceID,
		ProjectID:   model.ProjectID,
		Name:        model.Name,
		Description: model.Description,
		DataType:    model.DataType,
		TimeStart:   pgTimeValue(model.TimeStart),
		TimeEnd:     pgTimeValue(model.TimeEnd),
		Status:      model.Status,
		CreatedBy:   model.CreatedBy,
		Sources:     sourcesFromSQL(sources),
		CreatedAt:   pgTimeValue(model.CreatedAt),
		UpdatedAt:   pgTimeValue(model.UpdatedAt),
	}
}

func sourcesFromSQL(sources []sqlc.DatasetSource) []DatasetSource {
	items := make([]DatasetSource, 0, len(sources))
	for _, source := range sources {
		items = append(items, DatasetSource{
			ID:         source.ID,
			DatasetID:  source.DatasetID,
			SourceType: source.SourceType,
			SourceID:   source.SourceID,
			CreatedAt:  pgTimeValue(source.CreatedAt),
		})
	}
	return items
}

func telemetryPointsFromDatasource(points []datasource.TelemetryPoint) []TelemetryPoint {
	items := make([]TelemetryPoint, 0, len(points))
	for _, point := range points {
		items = append(items, TelemetryPoint{
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

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func pgTime(value time.Time) pgtype.Timestamptz {
	if value.IsZero() {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func pgTimeValue(value pgtype.Timestamptz) time.Time {
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
