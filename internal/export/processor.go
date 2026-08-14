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
	"sort"
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
	telemetrysvc "thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/tracing"
)

const (
	contentTypeCSV  = "text/csv; charset=utf-8"
	contentTypeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	contentTypeZIP  = "application/zip"
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
	telemetry   *telemetrysvc.Service
}

type requestConfig struct {
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Limit     int       `json:"limit"`
	MediaType string    `json:"media_type"`
	NodeID    int       `json:"node_id"`
	Field     string    `json:"field"`
}

type batchExportConfig struct {
	StartTime     time.Time `json:"start_time"`
	EndTime       time.Time `json:"end_time"`
	DeviceIDs     []string  `json:"device_ids"`
	GatewayID     string    `json:"gateway_id"`
	GatewayName   string    `json:"gateway_name"`
	IncludeData   bool      `json:"include_data"`
	IncludeImages bool      `json:"include_images"`
}

type carbonStationExportConfig struct {
	StartTime         time.Time `json:"start_time"`
	EndTime           time.Time `json:"end_time"`
	NodeIDs           []int     `json:"node_ids"`
	Fields            []string  `json:"fields"`
	IncludeFlux       bool      `json:"include_flux"`
	IncludeRawSamples bool      `json:"include_raw_samples"`
}

type qualityReportRow struct {
	DeviceID string
	Scope    string
	Name     string
	Status   string
	Count    int
	Detail   string
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

type CleanupExpiredFilesResult struct {
	ExportJobsExpired  int64
	ExportFilesExpired int
}

func NewProcessor(db *pgxpool.Pool, dataSources *datasource.Service, runtime Runtime, store objectstore.Store, cfg config.ExportConfig, logger *slog.Logger, telemetryServices ...*telemetrysvc.Service) *Processor {
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
	var telemetryService *telemetrysvc.Service
	if len(telemetryServices) > 0 {
		telemetryService = telemetryServices[0]
	}
	return &Processor{
		queries:     sqlc.New(db),
		dataSources: dataSources,
		runtime:     runtime,
		store:       store,
		cfg:         cfg,
		logger:      logger,
		telemetry:   telemetryService,
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

func (p *Processor) CleanupExpiredFiles(ctx context.Context, limit int) (CleanupExpiredFilesResult, error) {
	if err := p.validate(); err != nil {
		return CleanupExpiredFilesResult{}, err
	}
	if limit <= 0 {
		limit = 100
	}
	pendingExpired, err := p.queries.ExpireExportJobs(ctx)
	if err != nil {
		return CleanupExpiredFilesResult{}, apperr.Wrap(apperr.KindInternal, "expire export jobs", err)
	}
	rows, err := p.queries.ListExpiredExportFiles(ctx, int32(limit))
	if err != nil {
		return CleanupExpiredFilesResult{}, apperr.Wrap(apperr.KindInternal, "list expired export files", err)
	}

	result := CleanupExpiredFilesResult{ExportJobsExpired: pendingExpired}
	for _, row := range rows {
		if row.FileObjectKey != nil && strings.TrimSpace(*row.FileObjectKey) != "" {
			if err := p.store.Delete(ctx, *row.FileObjectKey); err != nil && apperr.KindOf(err) != apperr.KindNotFound {
				return result, apperr.Wrap(apperr.KindInternal, "delete expired export file", err)
			}
		}
		if _, err := p.queries.MarkExportJobExpired(ctx, row.ID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return result, apperr.Wrap(apperr.KindInternal, "mark export job expired", err)
		}
		result.ExportFilesExpired++
	}
	return result, nil
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
	case "carbon_station_zip":
		cfg, err := parseCarbonStationExportConfig(job.RequestConfig)
		if err != nil {
			return renderedExport{}, err
		}
		body, err := p.renderCarbonStationZIP(ctx, job, cfg)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{ObjectKey: exportObjectKey(job, "zip"), ContentType: contentTypeZIP, Body: body}, nil
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
	case "telemetry_excel":
		cfg, err := parseRequestConfig(job.RequestConfig, p.cfg.MaxRows)
		if err != nil {
			return renderedExport{}, err
		}
		series, err := p.queryTelemetry(ctx, job.ResourceType, job.ResourceID, cfg.StartTime, cfg.EndTime, cfg.Limit)
		if err != nil {
			return renderedExport{}, err
		}
		body, err := renderTelemetryXLSX(series)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{
			ObjectKey:   exportObjectKey(job, "xlsx"),
			ContentType: contentTypeXLSX,
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
	case "standard_station_zip", "group_site_zip":
		cfg, err := parseBatchExportConfig(job.RequestConfig)
		if err != nil {
			return renderedExport{}, err
		}
		body, err := p.renderDeviceBatchZIP(ctx, job, cfg)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{ObjectKey: exportObjectKey(job, "zip"), ContentType: contentTypeZIP, Body: body}, nil
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

func parseBatchExportConfig(raw json.RawMessage) (batchExportConfig, error) {
	var cfg batchExportConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return batchExportConfig{}, apperr.New(apperr.KindInvalidArgument, "invalid batch export request_config")
	}
	if cfg.StartTime.IsZero() || cfg.EndTime.IsZero() || !cfg.EndTime.After(cfg.StartTime) {
		return batchExportConfig{}, apperr.New(apperr.KindInvalidArgument, "valid start_time and end_time are required")
	}
	if len(cfg.DeviceIDs) == 0 {
		return batchExportConfig{}, apperr.New(apperr.KindInvalidArgument, "device_ids are required")
	}
	if !cfg.IncludeData && !cfg.IncludeImages {
		cfg.IncludeData = true
		cfg.IncludeImages = true
	}
	return cfg, nil
}

func parseCarbonStationExportConfig(raw json.RawMessage) (carbonStationExportConfig, error) {
	var cfg carbonStationExportConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, apperr.New(apperr.KindInvalidArgument, "invalid carbon export config")
	}
	if len(cfg.NodeIDs) == 0 || len(cfg.Fields) == 0 || !cfg.EndTime.After(cfg.StartTime) || (!cfg.IncludeFlux && !cfg.IncludeRawSamples) {
		return cfg, apperr.New(apperr.KindInvalidArgument, "invalid carbon export config")
	}
	return cfg, nil
}

func (p *Processor) renderDeviceBatchZIP(ctx context.Context, job Job, cfg batchExportConfig) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	quality := make([]qualityReportRow, 0)
	if err := writeBytesFile(zw, "README.txt", []byte("THCPN 数据导出\n时间均为北京时间（+08:00）；generation-report.csv 仅描述本次文件生成情况。\n")); err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.GatewayID) != "" {
		var gateway bytes.Buffer
		writer := csv.NewWriter(&gateway)
		_ = writer.Write([]string{"gateway_id", "gateway_name"})
		_ = writer.Write([]string{cfg.GatewayID, cfg.GatewayName})
		writer.Flush()
		if err := writer.Error(); err != nil {
			return nil, err
		}
		if err := writeBytesFile(zw, "gateway.csv", gateway.Bytes()); err != nil {
			return nil, err
		}
	}
	var deviceIndex bytes.Buffer
	deviceWriter := csv.NewWriter(&deviceIndex)
	if err := deviceWriter.Write([]string{"device_id", "device_name", "serial_no", "device_type", "folder"}); err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	for _, rawID := range cfg.DeviceIDs {
		id, err := uuid.Parse(strings.TrimSpace(rawID))
		if err != nil || id == uuid.Nil {
			return nil, apperr.New(apperr.KindInvalidArgument, "invalid device_id in batch export")
		}
		if _, ok := seen[id.String()]; ok {
			continue
		}
		seen[id.String()] = struct{}{}
		device, err := p.queries.GetDevice(ctx, id)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "batch device not found")
		}
		folder := safeArchiveSegment(device.Name)
		if folder == "" {
			folder = "device"
		}
		folder = path.Join(folder, safeArchiveSegment(id.String()[:8]))
		if err := deviceWriter.Write([]string{id.String(), device.Name, device.SerialNo, device.DeviceType, folder}); err != nil {
			return nil, err
		}

		series, telemetryErr := p.queryDeviceTelemetryRaw(ctx, id, cfg.StartTime, cfg.EndTime)
		if telemetryErr != nil {
			quality = append(quality, qualityReportRow{id.String(), "telemetry", "遥测数据", "missing", 0, telemetryErr.Error()})
		} else if cfg.IncludeData {
			body, metadata, count, err := renderWideTelemetryCSV(series)
			if err != nil {
				return nil, err
			}
			if err := writeBytesFile(zw, path.Join(folder, "data.csv"), body); err != nil {
				return nil, err
			}
			if err := writeMetadataCSV(zw, path.Join(folder, "metadata.csv"), metadata); err != nil {
				return nil, err
			}
			quality = append(quality, qualityReportRow{id.String(), "telemetry", "遥测数据", "packed", count, ""})
		}

		if cfg.IncludeImages {
			items, mediaErr := p.queryDeviceMediaAll(ctx, id, cfg.StartTime, cfg.EndTime)
			if mediaErr != nil {
				quality = append(quality, qualityReportRow{id.String(), "images", "图片", "missing", 0, mediaErr.Error()})
			} else {
				packed := make([]mediaExportItem, 0, len(items))
				used := map[string]int{}
				for _, item := range items {
					result, getErr := p.store.Get(ctx, item.ObjectKey)
					if getErr != nil || result.Body == nil {
						detail := "对象存储读取失败"
						if getErr != nil {
							detail = getErr.Error()
						}
						quality = append(quality, qualityReportRow{id.String(), "image", item.MediaID, "missing", 0, detail})
						continue
					}
					archivePath := path.Join(folder, mediaArchivePath(item, used))
					if writeErr := writeObjectFile(zw, archivePath, result.Body); writeErr != nil {
						_ = result.Body.Close()
						return nil, writeErr
					}
					_ = result.Body.Close()
					item.ArchivePath = archivePath
					packed = append(packed, item)
				}
				if err := writeMediaManifestCSVNamed(zw, path.Join(folder, "image-index.csv"), packed); err != nil {
					return nil, err
				}
				quality = append(quality, qualityReportRow{id.String(), "images", "图片", "packed", len(packed), ""})
			}
		}
	}
	deviceWriter.Flush()
	if err := deviceWriter.Error(); err != nil {
		return nil, err
	}
	if err := writeBytesFile(zw, "manifest.csv", deviceIndex.Bytes()); err != nil {
		return nil, err
	}
	if err := writeQualityReportCSV(zw, quality); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "close batch export zip", err)
	}
	return buf.Bytes(), nil
}

func (p *Processor) queryDeviceTelemetryRaw(ctx context.Context, deviceID uuid.UUID, start, end time.Time) ([]telemetrySeries, error) {
	streams, err := p.queries.ListDataStreamsByDevice(ctx, deviceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list data streams", err)
	}
	series := make([]telemetrySeries, 0, len(streams))
	for _, stream := range streams {
		if stream.Type != "telemetry" || stream.Status != "active" {
			continue
		}
		item, err := p.queryTelemetryStreamFull(ctx, stream, start, end)
		if err != nil {
			return nil, err
		}
		series = append(series, item)
	}
	return series, nil
}

func (p *Processor) queryTelemetryStreamFull(ctx context.Context, stream sqlc.DataStream, start, end time.Time) (telemetrySeries, error) {
	binding, err := p.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
	if err != nil {
		return telemetrySeries{}, err
	}
	source, err := p.dataSources.GetDataSource(ctx, binding.DataSourceID)
	if err != nil {
		return telemetrySeries{}, err
	}
	limit := p.cfg.MaxRows
	if limit <= 0 {
		limit = 100000
	}
	var result datasource.TelemetryResult
	for attempt := 0; attempt < 8; attempt++ {
		result, err = p.runtime.QueryTelemetry(ctx, source, datasource.TelemetryQuery{Binding: binding, Start: start, End: end, Limit: limit})
		if err != nil {
			return telemetrySeries{}, err
		}
		if result.Complete || len(result.Points) < limit {
			break
		}
		if limit >= 10_000_000 {
			return telemetrySeries{}, apperr.New(apperr.KindDataSource, "telemetry export exceeds the supported size without pagination")
		}
		limit *= 2
	}
	if !result.Complete && len(result.Points) >= limit {
		return telemetrySeries{}, apperr.New(apperr.KindDataSource, "telemetry export is incomplete")
	}
	unit := ""
	if stream.Unit != nil {
		unit = *stream.Unit
	}
	return telemetrySeries{DataStreamID: stream.ID, DeviceID: stream.DeviceID, Code: stream.Code, Name: stream.Name, Unit: unit, Points: result.Points}, nil
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
	mediaItems := make([]mediaExportItem, 0)
	usedMediaPaths := map[string]int{}
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
			items, err := p.queryMedia(ctx, "device", source.SourceID, start, end, p.cfg.MaxRows, "")
			if err != nil {
				return nil, err
			}
			mediaItems, err = p.writeMediaItems(ctx, zw, items, mediaItems, usedMediaPaths)
			if err != nil {
				return nil, err
			}
		case "data_stream":
			stream, err := p.queries.GetDataStream(ctx, source.SourceID)
			if err != nil {
				return nil, mapNotFoundOrInternal(err, "data stream source not found")
			}
			switch {
			case stream.Type == "telemetry":
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
			case isMediaStreamType(stream.Type):
				items, err := p.queryMediaStream(ctx, stream, start, end, p.cfg.MaxRows)
				if err != nil {
					return nil, err
				}
				mediaItems, err = p.writeMediaItems(ctx, zw, items, mediaItems, usedMediaPaths)
				if err != nil {
					return nil, err
				}
			}
		case "file":
			continue
		}
	}
	if len(mediaItems) > 0 {
		if err := writeMediaManifestCSVNamed(zw, "media/manifest.csv", mediaItems); err != nil {
			return nil, err
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
	items, err = p.writeMediaItems(ctx, zw, items, nil, usedPaths)
	if err != nil {
		_ = zw.Close()
		return nil, err
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

func (p *Processor) writeMediaItems(ctx context.Context, zw *zip.Writer, items []mediaExportItem, existing []mediaExportItem, usedPaths map[string]int) ([]mediaExportItem, error) {
	seen := make(map[string]struct{}, len(existing))
	for _, item := range existing {
		seen[item.DataStreamID.String()+"\x00"+item.MediaID] = struct{}{}
	}
	for i := range items {
		key := items[i].DataStreamID.String() + "\x00" + items[i].MediaID
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}

		archivePath := mediaArchivePath(items[i], usedPaths)
		items[i].ArchivePath = archivePath
		result, err := p.store.Get(ctx, items[i].ObjectKey)
		if err != nil {
			return nil, err
		}
		if result.Body == nil {
			return nil, apperr.New(apperr.KindInternal, "media object body is empty")
		}
		if err := writeObjectFile(zw, archivePath, result.Body); err != nil {
			_ = result.Body.Close()
			return nil, err
		}
		if err := result.Body.Close(); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "close media object", err)
		}
		existing = append(existing, items[i])
	}
	return existing, nil
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

func (p *Processor) queryDeviceMediaAll(ctx context.Context, deviceID uuid.UUID, start, end time.Time) ([]mediaExportItem, error) {
	device, err := p.queries.GetDevice(ctx, deviceID)
	if err != nil {
		return nil, mapNotFoundOrInternal(err, "device not found")
	}
	streams, err := p.queries.ListDataStreamsByDevice(ctx, device.ID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list data streams", err)
	}
	pageSize := p.cfg.MaxRows
	if pageSize <= 0 {
		pageSize = 100000
	}
	items := make([]mediaExportItem, 0)
	for _, stream := range streams {
		if !isMediaStreamType(stream.Type) || stream.Status != "active" {
			continue
		}
		binding, err := p.dataSources.GetActiveDataStreamBinding(ctx, stream.ID)
		if err != nil {
			return nil, err
		}
		source, err := p.dataSources.GetDataSource(ctx, binding.DataSourceID)
		if err != nil {
			return nil, err
		}
		page := 1
		streamCount := 0
		for {
			result, err := p.runtime.QueryMedia(ctx, source, datasource.MediaQuery{Binding: binding, Start: start, End: end, Page: page, PageSize: pageSize, MediaType: stream.Type})
			if err != nil {
				return nil, err
			}
			for _, record := range result.Items {
				thumbnail := ""
				if record.ThumbnailObjectKey != nil {
					thumbnail = *record.ThumbnailObjectKey
				}
				items = append(items, mediaExportItem{DataStreamID: stream.ID, DeviceID: stream.DeviceID, MediaID: record.ID, MediaType: record.MediaType, CapturedAt: record.CapturedAt, ObjectKey: record.ObjectKey, ThumbnailObjectKey: thumbnail})
				streamCount++
			}
			if len(result.Items) == 0 || streamCount >= result.Total || len(result.Items) < pageSize {
				break
			}
			page++
		}
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
	if p.telemetry != nil && (resourceType == "device" || resourceType == "data_stream") {
		input := telemetrysvc.QueryInput{StartTime: start, EndTime: end, Limit: limit}
		if resourceType == "device" {
			input.DeviceID = &resourceID
		} else {
			input.DataStreamID = &resourceID
		}
		result, err := p.telemetry.QueryInternal(ctx, input)
		if err != nil {
			return nil, err
		}
		items := make([]telemetrySeries, 0, len(result.Series))
		for _, series := range result.Series {
			points := make([]datasource.TelemetryPoint, 0, len(series.Points))
			for _, point := range series.Points {
				points = append(points, datasource.TelemetryPoint{Timestamp: point.Timestamp, Value: point.Value, Quality: point.Quality})
			}
			unit := ""
			if series.Unit != nil {
				unit = *series.Unit
			}
			items = append(items, telemetrySeries{
				DataStreamID: series.DataStreamID, DeviceID: result.DeviceID,
				Code: series.Code, Name: series.Name, Unit: unit, Points: points,
			})
		}
		return items, nil
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

func parseCarbonExportConfig(raw json.RawMessage, maxRows int) (requestConfig, error) {
	cfg, err := parseRequestConfig(raw, maxRows)
	if err != nil {
		return requestConfig{}, err
	}
	if cfg.NodeID <= 0 {
		return requestConfig{}, apperr.New(apperr.KindInvalidArgument, "node_id must be a positive integer")
	}
	if strings.TrimSpace(cfg.Field) == "" {
		return requestConfig{}, apperr.New(apperr.KindInvalidArgument, "field is required")
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

type telemetryMetadataRow struct {
	Code string
	Name string
	Unit string
	Type string
}

func renderWideTelemetryCSV(series []telemetrySeries) ([]byte, []telemetryMetadataRow, int, error) {
	columns := make([]telemetrySeries, len(series))
	copy(columns, series)
	sort.Slice(columns, func(i, j int) bool { return columns[i].Code < columns[j].Code })
	metadata := make([]telemetryMetadataRow, 0, len(columns))
	byTimestamp := map[string]map[string]datasource.TelemetryPoint{}
	for _, item := range columns {
		metadata = append(metadata, telemetryMetadataRow{Code: item.Code, Name: item.Name, Unit: item.Unit, Type: "telemetry"})
		for _, point := range item.Points {
			key := point.Timestamp.UTC().Format(time.RFC3339Nano)
			if byTimestamp[key] == nil {
				byTimestamp[key] = map[string]datasource.TelemetryPoint{}
			}
			byTimestamp[key][item.Code] = point
		}
	}
	timestamps := make([]string, 0, len(byTimestamp))
	for timestamp := range byTimestamp {
		timestamps = append(timestamps, timestamp)
	}
	sort.Strings(timestamps)
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	header := []string{"ts"}
	for _, item := range columns {
		header = append(header, item.Code)
	}
	if err := writer.Write(header); err != nil {
		return nil, nil, 0, apperr.Wrap(apperr.KindInternal, "write wide telemetry header", err)
	}
	for _, timestamp := range timestamps {
		row := []string{timestamp}
		for _, item := range columns {
			point, ok := byTimestamp[timestamp][item.Code]
			if !ok {
				row = append(row, "")
				continue
			}
			row = append(row, strconv.FormatFloat(point.Value, 'f', -1, 64))
		}
		if err := writer.Write(row); err != nil {
			return nil, nil, 0, apperr.Wrap(apperr.KindInternal, "write wide telemetry row", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, nil, 0, apperr.Wrap(apperr.KindInternal, "flush wide telemetry csv", err)
	}
	return buf.Bytes(), metadata, len(timestamps), nil
}

func writeMetadataCSV(zw *zip.Writer, name string, rows []telemetryMetadataRow) error {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"code", "name", "unit", "type"}); err != nil {
		return err
	}
	for _, row := range rows {
		if err := writer.Write([]string{row.Code, row.Name, row.Unit, row.Type}); err != nil {
			return err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return err
	}
	return writeBytesFile(zw, name, buf.Bytes())
}

func writeQualityReportCSV(zw *zip.Writer, rows []qualityReportRow) error {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"device_id", "scope", "name", "status", "packed_count", "detail"}); err != nil {
		return err
	}
	for _, row := range rows {
		if err := writer.Write([]string{row.DeviceID, row.Scope, row.Name, row.Status, strconv.Itoa(row.Count), row.Detail}); err != nil {
			return err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return err
	}
	return writeBytesFile(zw, "generation-report.csv", buf.Bytes())
}

func (p *Processor) renderCarbonStationZIP(ctx context.Context, job Job, cfg carbonStationExportConfig) ([]byte, error) {
	device, err := p.queries.GetDevice(ctx, job.ResourceID)
	if err != nil {
		return nil, mapNotFoundOrInternal(err, "carbon device not found")
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if err := writeBytesFile(zw, "README.txt", []byte("THCPN 碳汇站数据导出\n时间均为北京时间（+08:00）；空文件表示所选范围内没有对应数据。\n")); err != nil {
		return nil, err
	}
	var manifest bytes.Buffer
	manifestWriter := csv.NewWriter(&manifest)
	if err := manifestWriter.Write([]string{"device_id", "device_name", "serial_no", "node_id", "field", "content", "file"}); err != nil {
		return nil, err
	}
	report := make([]qualityReportRow, 0)
	deviceFolder := path.Join(safeArchiveSegment(device.Name), safeArchiveSegment(device.ID.String()[:8]))
	metadata := []telemetryMetadataRow{
		{Code: "device_id", Name: device.ID.String(), Type: "string"},
		{Code: "serial_no", Name: device.SerialNo, Type: "string"},
		{Code: "device_type", Name: device.DeviceType, Type: "string"},
		{Code: "start_time", Name: cfg.StartTime.Format(time.RFC3339), Type: "datetime"},
		{Code: "end_time", Name: cfg.EndTime.Format(time.RFC3339), Type: "datetime"},
	}
	if err := writeMetadataCSV(zw, path.Join(deviceFolder, "metadata.csv"), metadata); err != nil {
		return nil, err
	}
	for _, nodeID := range cfg.NodeIDs {
		for _, rawField := range cfg.Fields {
			field := strings.TrimSpace(rawField)
			folder := path.Join(deviceFolder, fmt.Sprintf("node-%d", nodeID), safeArchiveSegment(field))
			if cfg.IncludeFlux {
				points, queryErr := p.dataSources.CarbonFlux(ctx, job.ResourceID, nodeID, field, cfg.StartTime, cfg.EndTime)
				if queryErr != nil {
					return nil, queryErr
				}
				body, renderErr := renderCarbonFluxCSV(job.ResourceID, points.Points)
				if renderErr != nil {
					return nil, renderErr
				}
				name := path.Join(folder, "flux.csv")
				if err := writeBytesFile(zw, name, body); err != nil {
					return nil, err
				}
				_ = manifestWriter.Write([]string{device.ID.String(), device.Name, device.SerialNo, strconv.Itoa(nodeID), field, "flux", name})
				report = append(report, qualityReportRow{device.ID.String(), fmt.Sprintf("node-%d/%s", nodeID, field), "通量", "generated", len(points.Points), ""})
			}
			if cfg.IncludeRawSamples {
				rawCfg := requestConfig{StartTime: cfg.StartTime, EndTime: cfg.EndTime, NodeID: nodeID, Field: field, Limit: p.cfg.MaxRows}
				body, renderErr := p.renderCarbonRawCSV(ctx, job.ResourceID, rawCfg)
				if renderErr != nil {
					return nil, renderErr
				}
				name := path.Join(folder, "raw-samples.csv")
				if err := writeBytesFile(zw, name, body); err != nil {
					return nil, err
				}
				count := bytes.Count(body, []byte("\n")) - 1
				if count < 0 {
					count = 0
				}
				_ = manifestWriter.Write([]string{device.ID.String(), device.Name, device.SerialNo, strconv.Itoa(nodeID), field, "raw_samples", name})
				report = append(report, qualityReportRow{device.ID.String(), fmt.Sprintf("node-%d/%s", nodeID, field), "原始采样", "generated", count, ""})
			}
		}
	}
	manifestWriter.Flush()
	if err := manifestWriter.Error(); err != nil {
		return nil, err
	}
	if err := writeBytesFile(zw, "manifest.csv", manifest.Bytes()); err != nil {
		return nil, err
	}
	if err := writeQualityReportCSV(zw, report); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "close carbon export zip", err)
	}
	return buf.Bytes(), nil
}

func renderCarbonFluxCSV(deviceID uuid.UUID, points []datasource.CarbonFluxPoint) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"device_id", "node_id", "period", "period_at", "field", "nee", "er", "gpp", "unit"}); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "write carbon flux csv header", err)
	}
	for _, point := range points {
		if err := writer.Write([]string{
			deviceID.String(), strconv.Itoa(point.NodeID), point.Period, point.PeriodAt.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02 15:04:05"), point.Field,
			carbonFloat(point.NEE), carbonFloat(point.ER), carbonFloat(point.GPP), "μg CO₂·m⁻²·s⁻¹",
		}); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "write carbon flux csv row", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "flush carbon flux csv", err)
	}
	return buf.Bytes(), nil
}

func (p *Processor) renderCarbonRawCSV(ctx context.Context, deviceID uuid.UUID, cfg requestConfig) ([]byte, error) {
	periods, err := p.dataSources.CarbonPeriods(ctx, deviceID, cfg.NodeID, cfg.StartTime, cfg.EndTime)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"device_id", "node_id", "period", "period_at", "field", "room", "ts", "CO2", "tempL", "humiL", "tempB", "humiB", "stemp", "shumi"}); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "write carbon raw csv header", err)
	}
	rows := 0
	for _, summary := range periods {
		if rows >= cfg.Limit {
			break
		}
		detail, err := p.dataSources.CarbonPeriod(ctx, deviceID, cfg.NodeID, cfg.Field, summary.Period)
		if err != nil {
			if apperr.KindOf(err) == apperr.KindNotFound {
				continue
			}
			return nil, err
		}
		for _, phase := range detail.Phases {
			for _, sample := range phase.Points {
				if rows >= cfg.Limit {
					break
				}
				if err := writer.Write([]string{
					deviceID.String(), strconv.Itoa(cfg.NodeID), detail.Period, detail.PeriodAt.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02 15:04:05"), cfg.Field, phase.Room,
					sample.TS.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02 15:04:05"), carbonFloat(sample.CO2), carbonFloat(sample.TempL), carbonFloat(sample.HumiL), carbonFloat(sample.TempB), carbonFloat(sample.HumiB), carbonFloat(sample.STemp), carbonFloat(sample.SHumi),
				}); err != nil {
					return nil, apperr.Wrap(apperr.KindInternal, "write carbon raw csv row", err)
				}
				rows++
			}
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "flush carbon raw csv", err)
	}
	return buf.Bytes(), nil
}

func carbonFloat(value *float64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatFloat(*value, 'f', -1, 64)
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
