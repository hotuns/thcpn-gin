package export

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
)

const (
	ActionDatasetExport   = "dataset.export"
	ActionMediaDownload   = "media.download"
	ActionTelemetryExport = "telemetry.export"
	ActionCarbonExport    = "telemetry.export"
)

type Service struct {
	queries *sqlc.Queries
	signer  *objectstore.Signer
	cfg     config.ExportConfig
	billing *billing.Service
}

func (s *Service) SetBilling(service *billing.Service) { s.billing = service }

type Job struct {
	ID            uuid.UUID       `json:"id"`
	WorkspaceID   uuid.UUID       `json:"workspace_id"`
	RequestedBy   uuid.UUID       `json:"requested_by"`
	ResourceType  string          `json:"resource_type"`
	ResourceID    uuid.UUID       `json:"resource_id"`
	ExportType    string          `json:"export_type"`
	RequestConfig json.RawMessage `json:"request_config"`
	Status        string          `json:"status"`
	FileObjectKey *string         `json:"file_object_key,omitempty"`
	FileSizeBytes *int64          `json:"file_size_bytes,omitempty"`
	ErrorMessage  *string         `json:"error_message,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
	StartedAt     *time.Time      `json:"started_at,omitempty"`
	FinishedAt    *time.Time      `json:"finished_at,omitempty"`
	ExpiresAt     time.Time       `json:"expires_at"`
}

type CreateInput struct {
	ResourceType  string
	ResourceID    uuid.UUID
	ExportType    string
	RequestConfig json.RawMessage
	RequestedBy   uuid.UUID
	ExpiresAt     *time.Time
}

type ListInput struct {
	WorkspaceID uuid.UUID
	RequestedBy *uuid.UUID
	Limit       int32
}

type ResolvedResource struct {
	WorkspaceID            uuid.UUID
	ResourceType           string
	ResourceID             uuid.UUID
	ExportType             string
	Action                 string
	PermissionResourceType string
	PermissionResourceID   uuid.UUID
}

type DownloadResult struct {
	ExportJobID uuid.UUID `json:"export_job_id"`
	URL         string    `json:"url"`
	ExpiresAt   time.Time `json:"expires_at"`
}

func NewService(db *pgxpool.Pool, signer *objectstore.Signer, cfg config.ExportConfig) *Service {
	if cfg.FileTTLHours <= 0 {
		cfg.FileTTLHours = 72
	}
	return &Service{
		queries: sqlc.New(db),
		signer:  signer,
		cfg:     cfg,
	}
}

func (s *Service) Resolve(ctx context.Context, resourceType string, resourceID uuid.UUID, exportType string) (ResolvedResource, error) {
	resourceType = strings.TrimSpace(resourceType)
	exportType = strings.TrimSpace(exportType)
	if resourceID == uuid.Nil {
		return ResolvedResource{}, apperr.New(apperr.KindInvalidArgument, "resource_id is required")
	}
	action, permissionResourceType, err := resolveAction(resourceType, exportType)
	if err != nil {
		return ResolvedResource{}, err
	}

	resolved := ResolvedResource{
		ResourceType:           resourceType,
		ResourceID:             resourceID,
		ExportType:             exportType,
		Action:                 action,
		PermissionResourceType: permissionResourceType,
		PermissionResourceID:   resourceID,
	}
	switch resourceType {
	case "device", "device_batch":
		device, err := s.queries.GetDevice(ctx, resourceID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "device not found")
		}
		if exportType == "carbon_station_zip" && device.DeviceType != "carbon_sink" {
			return ResolvedResource{}, apperr.New(apperr.KindInvalidArgument, "carbon export requires a carbon sink device")
		}
		assignment, err := s.queries.GetActiveDeviceAssignment(ctx, device.ID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "active device assignment not found")
		}
		resolved.WorkspaceID = assignment.WorkspaceID
	case "data_stream":
		stream, err := s.queries.GetDataStream(ctx, resourceID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "data stream not found")
		}
		assignment, err := s.queries.GetActiveDeviceAssignmentByDataStream(ctx, stream.ID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "active device assignment not found")
		}
		resolved.WorkspaceID = assignment.WorkspaceID
	case "media":
		stream, err := s.queries.GetDataStream(ctx, resourceID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "data stream not found")
		}
		assignment, err := s.queries.GetActiveDeviceAssignmentByDataStream(ctx, stream.ID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "active device assignment not found")
		}
		resolved.WorkspaceID = assignment.WorkspaceID
		resolved.PermissionResourceID = stream.ID
	case "dataset":
		dataset, err := s.queries.GetDataset(ctx, resourceID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "dataset not found")
		}
		resolved.WorkspaceID = dataset.WorkspaceID
	default:
		return ResolvedResource{}, apperr.New(apperr.KindInvalidArgument, "invalid resource_type")
	}
	return resolved, nil
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Job, ResolvedResource, error) {
	if input.RequestedBy == uuid.Nil {
		return Job{}, ResolvedResource{}, apperr.New(apperr.KindInvalidArgument, "requested_by is required")
	}
	resolved, err := s.Resolve(ctx, input.ResourceType, input.ResourceID, input.ExportType)
	if err != nil {
		return Job{}, ResolvedResource{}, err
	}
	expiresAt := time.Now().UTC().Add(time.Duration(s.cfg.FileTTLHours) * time.Hour)
	if input.ExpiresAt != nil {
		expiresAt = input.ExpiresAt.UTC()
		if !expiresAt.After(time.Now().UTC()) {
			return Job{}, ResolvedResource{}, apperr.New(apperr.KindInvalidArgument, "expires_at must be in the future")
		}
	}
	requestConfig, err := normalizeRequestConfig(input.RequestConfig)
	if err != nil {
		return Job{}, ResolvedResource{}, err
	}
	if err := s.validatePlan(ctx, resolved, requestConfig); err != nil {
		return Job{}, ResolvedResource{}, err
	}
	if input.ResourceType == "device_batch" {
		if err := s.validateDeviceBatch(ctx, input.RequestedBy, resolved.WorkspaceID, resolved.ResourceID, input.ExportType, requestConfig); err != nil {
			return Job{}, ResolvedResource{}, err
		}
	}
	if input.ExportType == "carbon_station_zip" {
		if err := validateCarbonStationConfig(requestConfig); err != nil {
			return Job{}, ResolvedResource{}, err
		}
	}

	row, err := s.queries.CreateExportJob(ctx, sqlc.CreateExportJobParams{
		WorkspaceID:       resolved.WorkspaceID,
		RequestedBy:       input.RequestedBy,
		ResourceType:      resolved.ResourceType,
		ResourceID:        resolved.ResourceID,
		ExportType:        resolved.ExportType,
		RequestConfigJson: requestConfig,
		ExpiresAt:         pgTime(expiresAt),
	})
	if err != nil {
		return Job{}, ResolvedResource{}, mapWriteError(err, "create export job")
	}
	return jobFromSQL(row), resolved, nil
}

func (s *Service) validatePlan(ctx context.Context, resolved ResolvedResource, requestConfig []byte) error {
	if s.billing == nil {
		return nil
	}
	summary, err := s.billing.Summary(ctx, resolved.WorkspaceID)
	if err != nil {
		return err
	}
	if summary.Plan == billing.PlanProfessional {
		return nil
	}
	if resolved.ResourceType != "device" && resolved.ResourceType != "data_stream" {
		return apperr.New(apperr.KindPermissionDenied, "professional plan is required for batch or dataset exports")
	}
	switch resolved.ExportType {
	case "telemetry_csv", "telemetry_excel", "carbon_station_zip":
	default:
		return apperr.New(apperr.KindPermissionDenied, "professional plan is required for this export type")
	}
	var config map[string]any
	if err := json.Unmarshal(requestConfig, &config); err != nil {
		return apperr.New(apperr.KindInvalidArgument, "invalid export time range")
	}
	start, startOK := exportConfigTime(config, "start_time")
	end, endOK := exportConfigTime(config, "end_time")
	if !startOK || !endOK || !end.After(start) {
		return apperr.New(apperr.KindInvalidArgument, "start_time and end_time are required for base plan exports")
	}
	now := time.Now().UTC()
	days := s.billing.BaseExportDays()
	if end.After(now.Add(5*time.Minute)) || start.Before(now.AddDate(0, 0, -days)) || end.Sub(start) > time.Duration(days)*24*time.Hour {
		return apperr.New(apperr.KindPermissionDenied, "base plan export is outside the configured window")
	}
	return nil
}

func exportConfigTime(config map[string]any, key string) (time.Time, bool) {
	value, ok := config[key].(string)
	if !ok {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, value)
	return parsed.UTC(), err == nil
}

func (s *Service) Get(ctx context.Context, jobID uuid.UUID) (Job, error) {
	if jobID == uuid.Nil {
		return Job{}, apperr.New(apperr.KindInvalidArgument, "export job id is required")
	}
	row, err := s.queries.GetExportJob(ctx, jobID)
	if err != nil {
		return Job{}, mapNotFoundOrInternal(err, "export job not found")
	}
	return jobFromSQL(row), nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]Job, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	var (
		rows []sqlc.ExportJob
		err  error
	)
	if input.RequestedBy != nil {
		if input.WorkspaceID != uuid.Nil {
			rows, err = s.queries.ListExportJobsByRequesterAndWorkspace(ctx, sqlc.ListExportJobsByRequesterAndWorkspaceParams{
				WorkspaceID: input.WorkspaceID,
				RequestedBy: *input.RequestedBy,
				Limit:       limit,
			})
		} else {
			rows, err = s.queries.ListExportJobsByRequester(ctx, sqlc.ListExportJobsByRequesterParams{
				RequestedBy: *input.RequestedBy,
				Limit:       limit,
			})
		}
	} else {
		if input.WorkspaceID == uuid.Nil {
			return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
		}
		rows, err = s.queries.ListExportJobsByWorkspace(ctx, sqlc.ListExportJobsByWorkspaceParams{
			WorkspaceID: input.WorkspaceID,
			Limit:       limit,
		})
	}
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list export jobs", err)
	}

	items := make([]Job, 0, len(rows))
	for _, row := range rows {
		items = append(items, jobFromSQL(row))
	}
	return items, nil
}

func (s *Service) PrepareDownload(ctx context.Context, jobID uuid.UUID, actorIDs ...uuid.UUID) (DownloadResult, error) {
	actorID := uuid.Nil
	if len(actorIDs) > 0 {
		actorID = actorIDs[0]
	}
	return s.prepareDownload(ctx, jobID, nil, actorID, "export")
}

func (s *Service) PrepareAPIDownload(ctx context.Context, jobID, workspaceID uuid.UUID) (DownloadResult, error) {
	return s.prepareDownload(ctx, jobID, &workspaceID, uuid.Nil, "api_file")
}

func (s *Service) prepareDownload(ctx context.Context, jobID uuid.UUID, expectedWorkspaceID *uuid.UUID, actorID uuid.UUID, sourceType string) (DownloadResult, error) {
	if s.signer == nil {
		return DownloadResult{}, apperr.New(apperr.KindInternal, "object store signer is not configured")
	}
	job, err := s.Get(ctx, jobID)
	if err != nil {
		return DownloadResult{}, err
	}
	if expectedWorkspaceID != nil && job.WorkspaceID != *expectedWorkspaceID {
		return DownloadResult{}, apperr.New(apperr.KindNotFound, "export job not found")
	}
	if job.Status != "success" {
		return DownloadResult{}, apperr.New(apperr.KindConflict, "export job is not ready")
	}
	if !job.ExpiresAt.After(time.Now().UTC()) {
		return DownloadResult{}, apperr.New(apperr.KindConflict, "export file expired")
	}
	if job.FileObjectKey == nil || strings.TrimSpace(*job.FileObjectKey) == "" {
		return DownloadResult{}, apperr.New(apperr.KindConflict, "export file is not available")
	}
	if s.billing != nil && job.FileSizeBytes != nil && *job.FileSizeBytes > 0 {
		summary, summaryErr := s.billing.Summary(ctx, job.WorkspaceID)
		if summaryErr != nil {
			return DownloadResult{}, summaryErr
		}
		if summary.Plan == billing.PlanProfessional {
			resourceID := job.ID
			var actorUserID *uuid.UUID
			if actorID != uuid.Nil {
				actorUserID = &actorID
			}
			if err := s.billing.ReserveDownload(ctx, billing.ReserveDownloadInput{WorkspaceID: job.WorkspaceID, SourceType: sourceType, ResourceID: &resourceID, ObjectKey: *job.FileObjectKey, Bytes: *job.FileSizeBytes, ActorUserID: actorUserID, IdempotencyKey: sourceType + ":" + job.ID.String() + ":" + uuid.NewString()}); err != nil {
				return DownloadResult{}, err
			}
		}
	}
	signed, err := s.signer.SignObjectURL(*job.FileObjectKey, time.Until(job.ExpiresAt))
	if err != nil {
		return DownloadResult{}, err
	}
	return DownloadResult{ExportJobID: job.ID, URL: signed.URL, ExpiresAt: signed.ExpiresAt}, nil
}

func resolveAction(resourceType string, exportType string) (string, string, error) {
	switch exportType {
	case "carbon_station_zip":
		if resourceType != "device" {
			return "", "", apperr.New(apperr.KindInvalidArgument, "carbon export requires device resource")
		}
		return ActionCarbonExport, "device", nil
	case "telemetry_csv", "telemetry_excel":
		switch resourceType {
		case "device", "data_stream":
			return ActionTelemetryExport, resourceType, nil
		default:
			return "", "", apperr.New(apperr.KindInvalidArgument, "telemetry export requires device or data_stream resource")
		}
	case "dataset_zip":
		if resourceType != "dataset" {
			return "", "", apperr.New(apperr.KindInvalidArgument, "dataset export requires dataset resource")
		}
		return ActionDatasetExport, "dataset", nil
	case "media_zip":
		switch resourceType {
		case "device", "data_stream":
			return ActionMediaDownload, resourceType, nil
		case "media":
			return ActionMediaDownload, "data_stream", nil
		default:
			return "", "", apperr.New(apperr.KindInvalidArgument, "media export requires device, data_stream or media resource")
		}
	case "standard_station_zip", "group_site_zip":
		if resourceType != "device_batch" {
			return "", "", apperr.New(apperr.KindInvalidArgument, "batch station export requires device_batch resource")
		}
		return ActionTelemetryExport, "device", nil
	default:
		return "", "", apperr.New(apperr.KindInvalidArgument, "invalid export_type")
	}
}

func validateCarbonStationConfig(raw []byte) error {
	var config struct {
		NodeIDs           []int     `json:"node_ids"`
		Fields            []string  `json:"fields"`
		StartTime         time.Time `json:"start_time"`
		EndTime           time.Time `json:"end_time"`
		IncludeFlux       bool      `json:"include_flux"`
		IncludeRawSamples bool      `json:"include_raw_samples"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		return apperr.New(apperr.KindInvalidArgument, "invalid carbon export config")
	}
	if len(config.NodeIDs) == 0 || len(config.Fields) == 0 || !config.EndTime.After(config.StartTime) {
		return apperr.New(apperr.KindInvalidArgument, "node_ids, fields and valid time range are required")
	}
	if !config.IncludeFlux && !config.IncludeRawSamples {
		return apperr.New(apperr.KindInvalidArgument, "at least one carbon export content is required")
	}
	for _, nodeID := range config.NodeIDs {
		if nodeID <= 0 {
			return apperr.New(apperr.KindInvalidArgument, "node_ids must be positive")
		}
	}
	for _, field := range config.Fields {
		if strings.TrimSpace(field) == "" {
			return apperr.New(apperr.KindInvalidArgument, "fields must not be empty")
		}
	}
	return nil
}

func (s *Service) validateDeviceBatch(ctx context.Context, requestedBy, workspaceID, anchorID uuid.UUID, exportType string, raw []byte) error {
	var config struct {
		DeviceIDs []string `json:"device_ids"`
	}
	if err := json.Unmarshal(raw, &config); err != nil || len(config.DeviceIDs) == 0 {
		return apperr.New(apperr.KindInvalidArgument, "device_ids are required for batch export")
	}
	wantType := "standalone"
	if exportType == "group_site_zip" {
		wantType = "gateway_node"
	}
	seen := map[uuid.UUID]struct{}{}
	demoBatch := false
	for index, rawID := range config.DeviceIDs {
		id, err := uuid.Parse(strings.TrimSpace(rawID))
		if err != nil || id == uuid.Nil {
			return apperr.New(apperr.KindInvalidArgument, "device_ids must contain valid UUIDs")
		}
		if _, exists := seen[id]; exists {
			return apperr.New(apperr.KindInvalidArgument, "device_ids must not contain duplicates")
		}
		seen[id] = struct{}{}
		device, err := s.queries.GetDevice(ctx, id)
		if err != nil {
			return mapNotFoundOrInternal(err, "batch device not found")
		}
		if device.DeviceType != wantType {
			return apperr.New(apperr.KindInvalidArgument, "batch export cannot mix device systems")
		}
		assignment, err := s.queries.GetActiveDeviceAssignment(ctx, id)
		if err != nil {
			return mapNotFoundOrInternal(err, "active device assignment not found")
		}
		selected, err := s.queries.IsDemoDeviceForUser(ctx, requestedBy, id)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "check demo batch device", err)
		}
		if index == 0 {
			demoBatch = selected
		}
		if demoBatch && !selected {
			return apperr.New(apperr.KindPermissionDenied, "batch device is outside the demo showcase")
		}
		if !demoBatch && assignment.WorkspaceID != workspaceID {
			return apperr.New(apperr.KindPermissionDenied, "batch device is outside the current workspace")
		}
		if index == 0 && id != anchorID {
			return apperr.New(apperr.KindInvalidArgument, "resource_id must match the first device_id")
		}
	}
	return nil
}

func jobFromSQL(model sqlc.ExportJob) Job {
	return Job{
		ID:            model.ID,
		WorkspaceID:   model.WorkspaceID,
		RequestedBy:   model.RequestedBy,
		ResourceType:  model.ResourceType,
		ResourceID:    model.ResourceID,
		ExportType:    model.ExportType,
		RequestConfig: json.RawMessage(model.RequestConfigJson),
		Status:        model.Status,
		FileObjectKey: model.FileObjectKey,
		FileSizeBytes: pgInt8Ptr(model.FileSizeBytes),
		ErrorMessage:  model.ErrorMessage,
		CreatedAt:     pgTimeValue(model.CreatedAt),
		UpdatedAt:     pgTimeValue(model.UpdatedAt),
		StartedAt:     pgTimePtr(model.StartedAt),
		FinishedAt:    pgTimePtr(model.FinishedAt),
		ExpiresAt:     pgTimeValue(model.ExpiresAt),
	}
}

func pgInt8Ptr(value pgtype.Int8) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}

func normalizeRequestConfig(value json.RawMessage) ([]byte, error) {
	if len(value) == 0 {
		return []byte(`{}`), nil
	}
	var object map[string]any
	if err := json.Unmarshal(value, &object); err != nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "request_config must be a JSON object")
	}
	if object == nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "request_config must be a JSON object")
	}
	normalized, err := json.Marshal(object)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "marshal request_config", err)
	}
	return normalized, nil
}

func pgTime(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func pgTimeValue(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
}

func pgTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
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
