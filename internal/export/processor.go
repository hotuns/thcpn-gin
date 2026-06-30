package export

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/objectstore"
)

const (
	contentTypeCSV = "text/csv; charset=utf-8"
	contentTypeZIP = "application/zip"
)

type TelemetryRuntime interface {
	QueryTelemetry(ctx context.Context, source datasource.DataSource, req datasource.TelemetryQuery) (datasource.TelemetryResult, error)
}

type Processor struct {
	queries     *sqlc.Queries
	dataSources *datasource.Service
	runtime     TelemetryRuntime
	store       objectstore.Store
	cfg         config.ExportConfig
	logger      *slog.Logger
}

type requestConfig struct {
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Limit     int       `json:"limit"`
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

func NewProcessor(db *pgxpool.Pool, dataSources *datasource.Service, runtime TelemetryRuntime, store objectstore.Store, cfg config.ExportConfig, logger *slog.Logger) *Processor {
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
	if p == nil || p.queries == nil {
		return false, apperr.New(apperr.KindInternal, "export processor is not configured")
	}
	if p.store == nil {
		return false, apperr.New(apperr.KindInternal, "object store is not configured")
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

	rendered, err := p.render(ctx, job)
	if err != nil {
		return true, p.fail(ctx, job.ID, err)
	}
	if err := p.store.Put(ctx, objectstore.PutInput{
		ObjectKey:   rendered.ObjectKey,
		ContentType: rendered.ContentType,
		Body:        bytes.NewReader(rendered.Body),
	}); err != nil {
		return true, p.fail(ctx, job.ID, err)
	}
	if _, err := p.queries.MarkExportJobSuccess(ctx, sqlc.MarkExportJobSuccessParams{
		ID:            job.ID,
		FileObjectKey: &rendered.ObjectKey,
	}); err != nil {
		return true, apperr.Wrap(apperr.KindInternal, "mark export job success", err)
	}
	if p.logger != nil {
		p.logger.Info("export job processed", slog.String("job_id", job.ID.String()), slog.String("object_key", rendered.ObjectKey))
	}
	return true, nil
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
		return renderedExport{}, apperr.New(apperr.KindInvalidArgument, "media_zip worker generation is not implemented")
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
