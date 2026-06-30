package export

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/metrics"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/tracing"
)

const (
	contentTypeCSV = "text/csv; charset=utf-8"
	contentTypeZIP = "application/zip"
)

type TelemetryRuntime interface {
	QueryTelemetry(ctx context.Context, source datasource.DataSource, req datasource.TelemetryQuery) (datasource.TelemetryResult, error)
}

type MediaRuntime interface {
	QueryMedia(ctx context.Context, source datasource.DataSource, req datasource.MediaQuery) (datasource.MediaResult, error)
}

type Runtime interface {
	TelemetryRuntime
	MediaRuntime
}

type Processor struct {
	queries     *sqlc.Queries
	dataSources *datasource.Service
	runtime     Runtime
	store       objectstore.Store
	cfg         config.ExportConfig
	logger      *slog.Logger
}

type requestConfig struct {
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Limit     int       `json:"limit"`
	MediaType string    `json:"media_type"`
}

type telemetrySeries struct {
	DataStreamID uuid.UUID
	DeviceID     uuid.UUID
	Code         string
	Name         string
	Unit         string
	Points       []datasource.TelemetryPoint
}

type renderedExport struct {
	ObjectKey   string
	ContentType string
	Body        []byte
}

type mediaExportItem struct {
	DataStreamID       uuid.UUID
	DeviceID           uuid.UUID
	MediaID            string
	MediaType          string
	CapturedAt         time.Time
	ObjectKey          string
	ThumbnailObjectKey string
	ArchivePath        string
}

func NewProcessor(db *pgxpool.Pool, dataSources *datasource.Service, runtime Runtime, store objectstore.Store, cfg config.ExportConfig, logger *slog.Logger) *Processor {
	if dataSources == nil {
		dataSources = datasource.NewService(db)
	}
	if runtime == nil {
		runtime = datasource.NewRuntime(nil)
	}
	if cfg.FileTTLHours <= 0 {
		cfg.FileTTLHours = 72
	}
	if cfg.MaxRows <= 0 {
		cfg.MaxRows = 100000
	}
	return &Processor{
		queries:     sqlc.New(db),
		dataSources: dataSources,
		runtime:     runtime,
		store:       store,
		cfg:         cfg,
		logger:      logger,
	}
}

func (p *Processor) ProcessNext(ctx context.Context) (bool, error) {
	if err := p.validate(); err != nil {
		return false, err
	}
	if _, err := p.queries.ExpireExportJobs(ctx); err != nil {
		return false, apperr.Wrap(apperr.KindInternal, "expire export jobs", err)
	}

	row, err := p.queries.ClaimNextPendingExportJob(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, apperr.Wrap(apperr.KindInternal, "claim export job", err)
	}
	job := jobFromSQL(row)

	if err := p.processClaimed(ctx, job); err != nil {
		return true, err
	}
	return true, nil
}

func (p *Processor) ProcessJob(ctx context.Context, jobID uuid.UUID) (bool, error) {
	if err := p.validate(); err != nil {
		return false, err
	}
	if jobID == uuid.Nil {
		return false, apperr.New(apperr.KindInvalidArgument, "export job id is required")
	}
	if _, err := p.queries.ExpireExportJobs(ctx); err != nil {
		return false, apperr.Wrap(apperr.KindInternal, "expire export jobs", err)
	}

	row, err := p.queries.MarkExportJobRunning(ctx, jobID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return p.skipUnavailableJob(ctx, jobID)
		}
		return false, apperr.Wrap(apperr.KindInternal, "claim export job", err)
	}

	job := jobFromSQL(row)
	if err := p.processClaimed(ctx, job); err != nil {
		return true, err
	}
	return true, nil
}

func (p *Processor) validate() error {
	if p == nil || p.queries == nil {
		return apperr.New(apperr.KindInternal, "export processor is not configured")
	}
	if p.store == nil {
		return apperr.New(apperr.KindInternal, "object store is not configured")
	}
	return nil
}

func (p *Processor) skipUnavailableJob(ctx context.Context, jobID uuid.UUID) (bool, error) {
	row, err := p.queries.GetExportJob(ctx, jobID)
	if err != nil {
		return false, mapNotFoundOrInternal(err, "export job not found")
	}
	job := jobFromSQL(row)
	switch job.Status {
	case "success", "failed", "expired", "running":
		if p.logger != nil {
			p.logger.Info("export job is not pending", slog.String("job_id", job.ID.String()), slog.String("status", job.Status))
		}
		return false, nil
	default:
		return false, apperr.New(apperr.KindConflict, "export job is not available for processing")
	}
}

func (p *Processor) processClaimed(ctx context.Context, job Job) (err error) {
	start := time.Now()
	status := "success"
	ctx, span := tracing.Start(ctx, "export.process",
		attribute.String("export.job_id", job.ID.String()),
		attribute.String("export.type", job.ExportType),
		attribute.String("export.resource_type", job.ResourceType),
		attribute.String("export.workspace_id", job.WorkspaceID.String()),
	)
	defer func() {
		span.SetAttributes(attribute.String("export.status", status))
		tracing.End(span, err)
		metrics.ObserveExportJob(job.ExportType, status, time.Since(start))
	}()

	rendered, err := p.render(ctx, job)
	if err != nil {
		status = "failed"
		return p.fail(ctx, job.ID, err)
	}
	putCtx, putSpan := tracing.Start(ctx, "objectstore.put",
		attribute.String("objectstore.key", rendered.ObjectKey),
		attribute.String("objectstore.content_type", rendered.ContentType),
	)
	putErr := p.store.Put(putCtx, objectstore.PutInput{
		ObjectKey:   rendered.ObjectKey,
		ContentType: rendered.ContentType,
		Body:        bytes.NewReader(rendered.Body),
	})
	tracing.End(putSpan, putErr)
	if putErr != nil {
		status = "failed"
		return p.fail(ctx, job.ID, putErr)
	}
	if _, err := p.queries.MarkExportJobSuccess(ctx, sqlc.MarkExportJobSuccessParams{
		ID:            job.ID,
		FileObjectKey: &rendered.ObjectKey,
	}); err != nil {
		status = "error"
		return apperr.Wrap(apperr.KindInternal, "mark export job success", err)
	}
	if p.logger != nil {
		p.logger.Info("export job processed", slog.String("job_id", job.ID.String()), slog.String("object_key", rendered.ObjectKey))
	}
	return nil
}

func (p *Processor) ProcessAvailable(ctx context.Context, limit int) (int, error) {
	processed := 0
	for {
		if limit > 0 && processed >= limit {
			return processed, nil
		}
		ok, err := p.ProcessNext(ctx)
		if err != nil {
			return processed, err
		}
		if !ok {
			return processed, nil
		}
		processed++
	}
}

func (p *Processor) fail(ctx context.Context, jobID uuid.UUID, cause error) error {
	message := truncateError(apperr.MessageOf(cause), 1000)
	if _, err := p.queries.MarkExportJobFailed(ctx, sqlc.MarkExportJobFailedParams{
		ID:           jobID,
		ErrorMessage: &message,
	}); err != nil {
		return apperr.Wrap(apperr.KindInternal, "mark export job failed", err)
	}
	if p.logger != nil {
		p.logger.Warn("export job failed", slog.String("job_id", jobID.String()), slog.String("reason", message))
	}
	return cause
}

func (p *Processor) render(ctx context.Context, job Job) (renderedExport, error) {
	switch job.ExportType {
	case "telemetry_csv":
		cfg, err := parseRequestConfig(job.RequestConfig, p.cfg.MaxRows)
		if err != nil {
			return renderedExport{}, err
		}
		series, err := p.queryTelemetry(ctx, job.ResourceType, job.ResourceID, cfg.StartTime, cfg.EndTime, cfg.Limit)
		if err != nil {
			return renderedExport{}, err
		}
		body, err := renderTelemetryCSV(series)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{
			ObjectKey:   exportObjectKey(job, "csv"),
			ContentType: contentTypeCSV,
			Body:        body,
		}, nil
	case "dataset_zip":
		body, err := p.renderDatasetZIP(ctx, job)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{
			ObjectKey:   exportObjectKey(job, "zip"),
			ContentType: contentTypeZIP,
			Body:        body,
		}, nil
	case "telemetry_excel":
		return renderedExport{}, apperr.New(apperr.KindInvalidArgument, "telemetry_excel worker generation is not implemented")
	case "media_zip":
		cfg, err := parseRequestConfig(job.RequestConfig, p.cfg.MaxRows)
		if err != nil {
			return renderedExport{}, err
		}
		body, err := p.renderMediaZIP(ctx, job, cfg)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{
			ObjectKey:   exportObjectKey(job, "zip"),
			ContentType: contentTypeZIP,
			Body:        body,
		}, nil
	default:
		return renderedExport{}, apperr.New(apperr.KindInvalidArgument, "invalid export_type")
	}
}

func (p *Processor) renderDatasetZIP(ctx context.Context, job Job) ([]byte, error) {
	dataset, err := p.queries.GetDataset(ctx, job.ResourceID)
	if err != nil {
		return nil, mapNotFoundOrInternal(err, "dataset not found")
	}
	sources, err := p.queries.ListDatasetSources(ctx, dataset.ID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list dataset sources", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if err := writeJSONFile(zw, "dataset.json", map[string]any{
		"id":           dataset.ID,
		"workspace_id": dataset.WorkspaceID,
		"project_id":   dataset.ProjectID,
		"name":         dataset.Name,
		"description":  dataset.Description,
		"data_type":    dataset.DataType,
		"time_start":   pgTimeValue(dataset.TimeStart),
		"time_end":     pgTimeValue(dataset.TimeEnd),
		"status":       dataset.Status,
		"created_by":   dataset.CreatedBy,
	}); err != nil {
		return nil, err
	}
	if err := writeSourcesCSV(zw, sources); err != nil {
		return nil, err
	}

	start := pgTimeValue(dataset.TimeStart)
	end := pgTimeValue(dataset.TimeEnd)
	for _, source := range sources {
		switch source.SourceType {
		case "device":
			series, err := p.queryTelemetry(ctx, "device", source.SourceID, start, end, p.cfg.MaxRows)
			if err != nil {
				return nil, err
			}
			body, err := renderTelemetryCSV(series)
			if err != nil {
				return nil, err
			}
			if err := writeBytesFile(zw, "telemetry/device_"+source.SourceID.String()+".csv", body); err != nil {
				return nil, err
			}
		case "data_stream":
			stream, err := p.queries.GetDataStream(ctx, source.SourceID)
			if err != nil {
				return nil, mapNotFoundOrInternal(err, "data stream source not found")
			}
			if stream.Type != "telemetry" {
				continue
			}
			series, err := p.queryTelemetry(ctx, "data_stream", source.SourceID, start, end, p.cfg.MaxRows)
			if err != nil {
				return nil, err
			}
			body, err := renderTelemetryCSV(series)
			if err != nil {
				return nil, err
			}
			if err := writeBytesFile(zw, "telemetry/data_stream_"+source.SourceID.String()+".csv", body); err != nil {
				return nil, err
			}
		case "file":
			continue
		}
	}

	if err := zw.Close(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "close dataset export zip", err)
	}
	return buf.Bytes(), nil
}

func (p *Processor) renderMediaZIP(ctx context.Context, job Job, cfg requestConfig) ([]byte, error) {
	items, err := p.queryMedia(ctx, job.ResourceType, job.ResourceID, cfg.StartTime, cfg.EndTime, cfg.Limit, cfg.MediaType)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	usedPaths := map[string]int{}
	for i := range items {
		archivePath := mediaArchivePath(items[i], usedPaths)
		items[i].ArchivePath = archivePath

		result, err := p.store.Get(ctx, items[i].ObjectKey)
		if err != nil {
			_ = zw.Close()
			return nil, err
		}
		if err := writeObjectFile(zw, archivePath, result.Body); err != nil {
			_ = result.Body.Close()
			_ = zw.Close()
			return nil, err
		}
		if err := result.Body.Close(); err != nil {
			_ = zw.Close()
			return nil, apperr.Wrap(apperr.KindInternal, "close media object", err)
		}
	}
	if err := writeMediaManifestCSV(zw, items); err != nil {
		_ = zw.Close()
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "close media export zip", err)
	}
	return buf.Bytes(), nil
}

func (p *Processor) queryMedia(ctx context.Context, resourceType string, resourceID uuid.UUID, start time.Time, end time.Time, limit int, mediaType string) ([]mediaExportItem, error) {
	if start.IsZero() || end.IsZero() {
		return nil, apperr.New(apperr.KindInvalidArgument, "start_time and end_time are required")
	}
	if !end.After(start) {
		return nil, apperr.New(apperr.KindInvalidArgument, "end_time must be after start_time")
	}
	if limit <= 0 || limit > p.cfg.MaxRows {
		limit = p.cfg.MaxRows
	}
	mediaType = strings.TrimSpace(mediaType)

	switch resourceType {
	case "device":
		device, err := p.queries.GetDevice(ctx, resourceID)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "device not found")
		}
		streams, err := p.queries.ListDataStreamsByDevice(ctx, device.ID)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "list data streams", err)
		}
		items := make([]mediaExportItem, 0)
		for _, stream := range streams {
			if !isMediaStreamType(stream.Type) || stream.Status != "active" {
				continue
			}
			if mediaType != "" && stream.Type != mediaType {
				continue
			}
			streamItems, err := p.queryMediaStream(ctx, stream, start, end, remainingLimit(limit, len(items)))
			if err != nil {
				return nil, err
			}
			items = append(items, streamItems...)
			if len(items) >= limit {
				return items[:limit], nil
			}
		}
		return items, nil
	case "data_stream", "media":
		stream, err := p.queries.GetDataStream(ctx, resourceID)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "data stream not found")
		}
		if !isMediaStreamType(stream.Type) {
			return nil, apperr.New(apperr.KindInvalidArgument, "data stream is not media")
		}
		if stream.Status != "active" {
			return nil, apperr.New(apperr.KindInvalidArgument, "data stream is not active")
		}
		if mediaType != "" && stream.Type != mediaType {
			return nil, apperr.New(apperr.KindInvalidArgument, "data stream media type does not match")
		}
		return p.queryMediaStream(ctx, stream, start, end, limit)
	default:
		return nil, apperr.New(apperr.KindInvalidArgument, "media export requires device, data_stream or media resource")
	}
}

func (p *Processor) queryMediaStream(ctx context.Context, stream sqlc.DataStream, start time.Time, end time.Time, limit int) ([]mediaExportItem, error) {
	if limit <= 0 {
		return nil, nil
	}
	binding, err := p.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
	if err != nil {
		return nil, err
	}
	source, err := p.dataSources.GetDataSource(ctx, binding.DataSourceID)
	if err != nil {
		return nil, err
	}
	result, err := p.runtime.QueryMedia(ctx, source, datasource.MediaQuery{
		Binding:   binding,
		Start:     start,
		End:       end,
		Page:      1,
		PageSize:  limit,
		MediaType: stream.Type,
	})
	if err != nil {
		return nil, err
	}
	items := make([]mediaExportItem, 0, len(result.Items))
	for _, record := range result.Items {
		thumbnail := ""
		if record.ThumbnailObjectKey != nil {
			thumbnail = *record.ThumbnailObjectKey
		}
		items = append(items, mediaExportItem{
			DataStreamID:       stream.ID,
			DeviceID:           stream.DeviceID,
			MediaID:            record.ID,
			MediaType:          record.MediaType,
			CapturedAt:         record.CapturedAt,
			ObjectKey:          record.ObjectKey,
			ThumbnailObjectKey: thumbnail,
		})
	}
	return items, nil
}

func (p *Processor) queryTelemetry(ctx context.Context, resourceType string, resourceID uuid.UUID, start time.Time, end time.Time, limit int) ([]telemetrySeries, error) {
	if start.IsZero() || end.IsZero() {
		return nil, apperr.New(apperr.KindInvalidArgument, "start_time and end_time are required")
	}
	if !end.After(start) {
		return nil, apperr.New(apperr.KindInvalidArgument, "end_time must be after start_time")
	}
	if limit <= 0 || limit > p.cfg.MaxRows {
		limit = p.cfg.MaxRows
	}

	switch resourceType {
	case "device":
		device, err := p.queries.GetDevice(ctx, resourceID)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "device not found")
		}
		streams, err := p.queries.ListDataStreamsByDevice(ctx, device.ID)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "list data streams", err)
		}
		series := make([]telemetrySeries, 0)
		for _, stream := range streams {
			if stream.Type != "telemetry" || stream.Status != "active" {
				continue
			}
			item, err := p.queryTelemetryStream(ctx, stream, start, end, limit)
			if err != nil {
				return nil, err
			}
			series = append(series, item)
		}
		return series, nil
	case "data_stream":
		stream, err := p.queries.GetDataStream(ctx, resourceID)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "data stream not found")
		}
		if stream.Type != "telemetry" {
			return nil, apperr.New(apperr.KindInvalidArgument, "data stream is not telemetry")
		}
		if stream.Status != "active" {
			return nil, apperr.New(apperr.KindInvalidArgument, "data stream is not active")
		}
		item, err := p.queryTelemetryStream(ctx, stream, start, end, limit)
		if err != nil {
			return nil, err
		}
		return []telemetrySeries{item}, nil
	default:
		return nil, apperr.New(apperr.KindInvalidArgument, "telemetry export requires device or data_stream resource")
	}
}

func (p *Processor) queryTelemetryStream(ctx context.Context, stream sqlc.DataStream, start time.Time, end time.Time, limit int) (telemetrySeries, error) {
	binding, err := p.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
	if err != nil {
		return telemetrySeries{}, err
	}
	source, err := p.dataSources.GetDataSource(ctx, binding.DataSourceID)
	if err != nil {
		return telemetrySeries{}, err
	}
	result, err := p.runtime.QueryTelemetry(ctx, source, datasource.TelemetryQuery{
		Binding: binding,
		Start:   start,
		End:     end,
		Limit:   limit,
	})
	if err != nil {
		return telemetrySeries{}, err
	}

	unit := ""
	if stream.Unit != nil {
		unit = *stream.Unit
	}
	return telemetrySeries{
		DataStreamID: stream.ID,
		DeviceID:     stream.DeviceID,
		Code:         stream.Code,
		Name:         stream.Name,
		Unit:         unit,
		Points:       result.Points,
	}, nil
}

func parseRequestConfig(raw json.RawMessage, maxRows int) (requestConfig, error) {
	if len(raw) == 0 {
		return requestConfig{}, apperr.New(apperr.KindInvalidArgument, "request_config is required")
	}
	var cfg requestConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return requestConfig{}, apperr.New(apperr.KindInvalidArgument, "invalid request_config")
	}
	if cfg.StartTime.IsZero() || cfg.EndTime.IsZero() {
		return requestConfig{}, apperr.New(apperr.KindInvalidArgument, "start_time and end_time are required")
	}
	if !cfg.EndTime.After(cfg.StartTime) {
		return requestConfig{}, apperr.New(apperr.KindInvalidArgument, "end_time must be after start_time")
	}
	if maxRows <= 0 {
		maxRows = 100000
	}
	if cfg.Limit <= 0 || cfg.Limit > maxRows {
		cfg.Limit = maxRows
	}
	return cfg, nil
}

func isMediaStreamType(value string) bool {
	switch value {
	case "image", "video", "audio":
		return true
	default:
		return false
	}
}

func remainingLimit(limit int, used int) int {
	if limit <= 0 {
		return 0
	}
	remaining := limit - used
	if remaining < 0 {
		return 0
	}
	return remaining
}

func renderTelemetryCSV(series []telemetrySeries) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"data_stream_id", "device_id", "code", "name", "unit", "ts", "value", "quality"}); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "write telemetry csv header", err)
	}
	for _, item := range series {
		for _, point := range item.Points {
			if err := writer.Write([]string{
				item.DataStreamID.String(),
				item.DeviceID.String(),
				item.Code,
				item.Name,
				item.Unit,
				point.Timestamp.UTC().Format(time.RFC3339Nano),
				strconv.FormatFloat(point.Value, 'f', -1, 64),
				point.Quality,
			}); err != nil {
				return nil, apperr.Wrap(apperr.KindInternal, "write telemetry csv row", err)
			}
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "flush telemetry csv", err)
	}
	return buf.Bytes(), nil
}

func writeSourcesCSV(zw *zip.Writer, sources []sqlc.DatasetSource) error {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"source_type", "source_id"}); err != nil {
		return apperr.Wrap(apperr.KindInternal, "write dataset sources header", err)
	}
	for _, source := range sources {
		if err := writer.Write([]string{source.SourceType, source.SourceID.String()}); err != nil {
			return apperr.Wrap(apperr.KindInternal, "write dataset sources row", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "flush dataset sources csv", err)
	}
	return writeBytesFile(zw, "sources.csv", buf.Bytes())
}

func writeMediaManifestCSV(zw *zip.Writer, items []mediaExportItem) error {
	return writeMediaManifestCSVNamed(zw, "manifest.csv", items)
}

func writeMediaManifestCSVNamed(zw *zip.Writer, name string, items []mediaExportItem) error {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"data_stream_id", "device_id", "media_id", "media_type", "captured_at", "object_key", "archive_path", "thumbnail_object_key"}); err != nil {
		return apperr.Wrap(apperr.KindInternal, "write media manifest header", err)
	}
	for _, item := range items {
		if err := writer.Write([]string{
			item.DataStreamID.String(),
			item.DeviceID.String(),
			item.MediaID,
			item.MediaType,
			item.CapturedAt.UTC().Format(time.RFC3339Nano),
			item.ObjectKey,
			item.ArchivePath,
			item.ThumbnailObjectKey,
		}); err != nil {
			return apperr.Wrap(apperr.KindInternal, "write media manifest row", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "flush media manifest csv", err)
	}
	return writeBytesFile(zw, name, buf.Bytes())
}

func writeJSONFile(zw *zip.Writer, name string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "marshal "+name, err)
	}
	data = append(data, '\n')
	return writeBytesFile(zw, name, data)
}

func writeBytesFile(zw *zip.Writer, name string, data []byte) error {
	file, err := zw.Create(name)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "create "+name, err)
	}
	if _, err := file.Write(data); err != nil {
		return apperr.Wrap(apperr.KindInternal, "write "+name, err)
	}
	return nil
}

func writeObjectFile(zw *zip.Writer, name string, reader io.Reader) error {
	file, err := zw.Create(name)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "create "+name, err)
	}
	if _, err := io.Copy(file, reader); err != nil {
		return apperr.Wrap(apperr.KindInternal, "write "+name, err)
	}
	return nil
}

func mediaArchivePath(item mediaExportItem, used map[string]int) string {
	mediaID := safeArchiveSegment(item.MediaID)
	if mediaID == "" {
		mediaID = "media"
	}
	mediaType := safeArchiveSegment(item.MediaType)
	if mediaType == "" {
		mediaType = "media"
	}
	ext := strings.ToLower(filepath.Ext(item.ObjectKey))
	if ext == "" || strings.Contains(ext, "/") || strings.Contains(ext, "\\") {
		ext = ".bin"
	}
	base := path.Join("media", item.DataStreamID.String(), mediaType+"_"+mediaID+ext)
	count := used[base]
	used[base] = count + 1
	if count == 0 {
		return base
	}
	return strings.TrimSuffix(base, ext) + "_" + strconv.Itoa(count+1) + ext
}

func safeArchiveSegment(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	return strings.Trim(b.String(), "_")
}

func exportObjectKey(job Job, ext string) string {
	ext = strings.TrimPrefix(strings.TrimSpace(ext), ".")
	if ext == "" {
		ext = "bin"
	}
	return path.Join("exports", job.WorkspaceID.String(), fmt.Sprintf("%s.%s", job.ID.String(), ext))
}

func truncateError(value string, max int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "export job failed"
	}
	if max > 0 && len(value) > max {
		return value[:max]
	}
	return value
}
