package export

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
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
)

const (
	ActionDatasetExport   = "dataset.export"
	ActionMediaDownload   = "media.download"
	ActionTelemetryExport = "telemetry.export"
)

type Service struct {
	queries *sqlc.Queries
	signer  *objectstore.Signer
	cfg     config.ExportConfig
}

type Job struct {
	ID            uuid.UUID  `json:"id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id"`
	RequestedBy   uuid.UUID  `json:"requested_by"`
	ResourceType  string     `json:"resource_type"`
	ResourceID    uuid.UUID  `json:"resource_id"`
	ExportType    string     `json:"export_type"`
	Status        string     `json:"status"`
	FileObjectKey *string    `json:"file_object_key,omitempty"`
	ErrorMessage  *string    `json:"error_message,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	FinishedAt    *time.Time `json:"finished_at,omitempty"`
	ExpiresAt     time.Time  `json:"expires_at"`
}

type CreateInput struct {
	ResourceType string
	ResourceID   uuid.UUID
	ExportType   string
	RequestedBy  uuid.UUID
	ExpiresAt    *time.Time
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
	case "device":
		device, err := s.queries.GetDevice(ctx, resourceID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "device not found")
		}
		resolved.WorkspaceID = device.WorkspaceID
	case "data_stream":
		stream, err := s.queries.GetDataStream(ctx, resourceID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "data stream not found")
		}
		resolved.WorkspaceID = stream.WorkspaceID
	case "media":
		stream, err := s.queries.GetDataStream(ctx, resourceID)
		if err != nil {
			return ResolvedResource{}, mapNotFoundOrInternal(err, "data stream not found")
		}
		resolved.WorkspaceID = stream.WorkspaceID
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

	row, err := s.queries.CreateExportJob(ctx, sqlc.CreateExportJobParams{
		WorkspaceID:  resolved.WorkspaceID,
		RequestedBy:  input.RequestedBy,
		ResourceType: resolved.ResourceType,
		ResourceID:   resolved.ResourceID,
		ExportType:   resolved.ExportType,
		ExpiresAt:    pgTime(expiresAt),
	})
	if err != nil {
		return Job{}, ResolvedResource{}, mapWriteError(err, "create export job")
	}
	return jobFromSQL(row), resolved, nil
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
		rows, err = s.queries.ListExportJobsByRequester(ctx, sqlc.ListExportJobsByRequesterParams{
			RequestedBy: *input.RequestedBy,
			Limit:       limit,
		})
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

func (s *Service) PrepareDownload(ctx context.Context, jobID uuid.UUID) (DownloadResult, error) {
	if s.signer == nil {
		return DownloadResult{}, apperr.New(apperr.KindInternal, "object store signer is not configured")
	}
	job, err := s.Get(ctx, jobID)
	if err != nil {
		return DownloadResult{}, err
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
	signed, err := s.signer.SignObjectURL(*job.FileObjectKey, time.Until(job.ExpiresAt))
	if err != nil {
		return DownloadResult{}, err
	}
	return DownloadResult{ExportJobID: job.ID, URL: signed.URL, ExpiresAt: signed.ExpiresAt}, nil
}

func resolveAction(resourceType string, exportType string) (string, string, error) {
	switch exportType {
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
	default:
		return "", "", apperr.New(apperr.KindInvalidArgument, "invalid export_type")
	}
}

func jobFromSQL(model sqlc.ExportJob) Job {
	return Job{
		ID:            model.ID,
		WorkspaceID:   model.WorkspaceID,
		RequestedBy:   model.RequestedBy,
		ResourceType:  model.ResourceType,
		ResourceID:    model.ResourceID,
		ExportType:    model.ExportType,
		Status:        model.Status,
		FileObjectKey: model.FileObjectKey,
		ErrorMessage:  model.ErrorMessage,
		CreatedAt:     pgTimeValue(model.CreatedAt),
		UpdatedAt:     pgTimeValue(model.UpdatedAt),
		StartedAt:     pgTimePtr(model.StartedAt),
		FinishedAt:    pgTimePtr(model.FinishedAt),
		ExpiresAt:     pgTimeValue(model.ExpiresAt),
	}
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
