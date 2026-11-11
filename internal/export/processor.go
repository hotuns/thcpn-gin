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
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"thcpn-gin/internal/observation"
	"thcpn-gin/internal/systemsettings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	platform "thcpn-gin/internal/datasource/platform"
	carbon "thcpn-gin/internal/datasource/sources/carbon"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/device"
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
	QueryTelemetry(ctx context.Context, source platform.DataSource, req platform.TelemetryQuery) (platform.TelemetryResult, error)
}

type MediaRuntime interface {
	QueryMedia(ctx context.Context, source platform.DataSource, req platform.MediaQuery) (platform.MediaResult, error)
}

type Runtime interface {
	TelemetryRuntime
	MediaRuntime
}

type Processor struct {
	settings    *systemsettings.Service
	devices     *device.Service
	queries     *sqlc.Queries
	dataSources *datasource.Service
	runtime     Runtime
	store       objectstore.Store
	httpClient  *http.Client
	cfg         config.ExportConfig
	logger      *slog.Logger
	telemetry   *telemetrysvc.Service
	limitOnce   sync.Once
	slots       chan struct{}
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
	NodeNames     map[string]string   `json:"node_names,omitempty"`
	NodeIndices   map[string]int64    `json:"node_indices,omitempty"`
	NodeTargets   []device.NodeTarget `json:"node_targets,omitempty"`
	StartTime     time.Time           `json:"start_time"`
	EndTime       time.Time           `json:"end_time"`
	DeviceIDs     []string            `json:"device_ids"`
	GatewayID     string              `json:"gateway_id"`
	GatewayName   string              `json:"gateway_name"`
	IncludeStatus bool                `json:"include_status"`
	IncludeData   bool                `json:"include_data"`
	IncludeImages bool                `json:"include_images"`
}

type carbonStationExportConfig struct {
	NodeNames         map[string]string `json:"node_names,omitempty"`
	StartTime         time.Time         `json:"start_time"`
	EndTime           time.Time         `json:"end_time"`
	NodeIDs           []int             `json:"node_ids"`
	Fields            []string          `json:"fields"`
	IncludeFlux       bool              `json:"include_flux"`
	IncludeRawSamples bool              `json:"include_raw_samples"`
}

type qualityReportRow struct {
	AssetNo string
	Scope   string
	Name    string
	Status  string
	Count   int
	Detail  string
}

type telemetrySeries struct {
	AssetNo        string
	DeviceName     string
	GatewayAssetNo string
	CurrentNodeSN  string
	NodeKey        string
	NodeName       string
	NodeIndex      *int
	MetricName     string
	DataStreamID   uuid.UUID
	DeviceID       uuid.UUID
	Code           string
	Name           string
	Unit           string
	Points         []platform.TelemetryPoint
}

type renderedExport struct {
	Extension   string
	ContentType string
	Body        []byte
}

type mediaExportItem struct {
	DataStreamID uuid.UUID
	AssetNo      string
	StreamCode   string
	MediaID      string
	MediaType    string
	CameraName   string
	CapturedAt   time.Time
	ObjectKey    string
	ArchivePath  string
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
		devices:     device.NewService(db),
		queries:     sqlc.New(db),
		dataSources: dataSources,
		runtime:     runtime,
		store:       store,
		httpClient:  &http.Client{Timeout: 2 * time.Minute},
		cfg:         cfg,
		logger:      logger,
		telemetry:   telemetryService,
	}
}

func (p *Processor) ProcessNext(ctx context.Context) (bool, error) {
	if p.settings != nil {
		var err error
		ctx, err = p.settings.Context(ctx)
		if err != nil {
			return false, err
		}
	}
	if err := p.validate(); err != nil {
		return false, err
	}
	if !p.acquire(ctx) {
		return false, ctx.Err()
	}
	defer p.release()
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
	if p.settings != nil {
		var err error
		ctx, err = p.settings.Context(ctx)
		if err != nil {
			return false, err
		}
	}
	if err := p.validate(); err != nil {
		return false, err
	}
	if jobID == uuid.Nil {
		return false, apperr.New(apperr.KindInvalidArgument, "export job id is required")
	}
	if !p.acquire(ctx) {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		_, _ = p.queries.FailWaitingExportJob(cleanup, jobID)
		return false, ctx.Err()
	}
	defer p.release()
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

func observationContextForJob(ctx context.Context, job Job) context.Context {
	if job.RequestedByAdmin != nil {
		phase := observation.All
		var config struct {
			DataPhase string `json:"data_phase"`
		}
		if json.Unmarshal(job.RequestConfig, &config) == nil && (config.DataPhase == observation.Formal || config.DataPhase == observation.Testing) {
			phase = config.DataPhase
		}
		return observation.WithPhase(ctx, phase)
	}
	return observation.WithPhase(ctx, observation.Formal)
}

func (p *Processor) processClaimed(ctx context.Context, job Job) (err error) {
	ctx = observationContextForJob(ctx, job)
	ctx, cancel := context.WithTimeout(ctx, 6*time.Hour)
	defer cancel()
	progress := &exportProgress{}
	ctx = context.WithValue(ctx, progressKey{}, progress)
	stopHeartbeat := p.startHeartbeat(ctx, cancel, job.ID, progress)
	defer stopHeartbeat()
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
	defer func() {
		if recovered := recover(); recovered != nil {
			err = errors.New("export worker panic")
		}
		if err != nil {
			status = "failed"
			err = p.fail(ctx, job.ID, err)
		}
	}()

	file, err := p.newTempFile(job.ID, ctx)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close(); _ = os.Remove(file.Name()) }()
	output := &archiveFileWriter{ctx: ctx, file: file, progress: progress, reserve: p.minFreeBytes(ctx)}
	rendered, err := p.render(ctx, job, output)
	if err != nil {
		status = "failed"
		return err
	}
	objectKey, err := p.exportObjectKey(ctx, job, rendered.Extension)
	if err != nil {
		return err
	}
	if len(rendered.Body) > 0 {
		if _, err = output.Write(rendered.Body); err != nil {
			return err
		}
	}
	size, err := file.Seek(0, io.SeekCurrent)
	if err != nil {
		return err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	progress.uploading.Store(true)
	putCtx, putSpan := tracing.Start(ctx, "objectstore.put",
		attribute.String("objectstore.key", objectKey),
		attribute.String("objectstore.content_type", rendered.ContentType),
	)
	putErr := p.store.Put(putCtx, objectstore.PutInput{
		ObjectKey:   objectKey,
		ContentType: rendered.ContentType,
		Body:        file,
	})
	tracing.End(putSpan, putErr)
	if putErr != nil {
		status = "failed"
		return putErr
	}
	if _, err := p.queries.MarkExportJobSuccess(ctx, sqlc.MarkExportJobSuccessParams{
		ID:            job.ID,
		FileObjectKey: &objectKey,
		FileSizeBytes: pgtype.Int8{Int64: size, Valid: true},
	}); err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = p.store.Delete(cleanup, objectKey)
		status = "error"
		return apperr.Wrap(apperr.KindInternal, "mark export job success", err)
	}
	if p.logger != nil {
		p.logger.Info("export job processed", slog.String("job_id", job.ID.String()), slog.String("object_key", objectKey))
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
	// The execution context is often canceled during shutdown; status persistence must survive it.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
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

func (p *Processor) render(ctx context.Context, job Job, output io.Writer) (renderedExport, error) {
	switch job.ExportType {
	case "carbon_station_zip":
		cfg, err := parseCarbonStationExportConfig(job.RequestConfig)
		if err != nil {
			return renderedExport{}, err
		}
		err = p.renderCarbonStationZIP(ctx, job, cfg, output)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{Extension: "zip", ContentType: contentTypeZIP}, nil
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
			Extension:   "csv",
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
			Extension:   "xlsx",
			ContentType: contentTypeXLSX,
			Body:        body,
		}, nil
	case "dataset_zip":
		err := p.renderDatasetZIP(ctx, job, output)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{
			Extension:   "zip",
			ContentType: contentTypeZIP,
		}, nil
	case "standard_station_zip", "group_site_zip":
		cfg, err := parseBatchExportConfig(job.RequestConfig)
		if err != nil {
			return renderedExport{}, err
		}
		err = p.renderDeviceBatchZIP(ctx, job, cfg, output)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{Extension: "zip", ContentType: contentTypeZIP}, nil
	case "media_zip":
		cfg, err := parseRequestConfig(job.RequestConfig, p.cfg.MaxRows)
		if err != nil {
			return renderedExport{}, err
		}
		err = p.renderMediaZIP(ctx, job, cfg, output)
		if err != nil {
			return renderedExport{}, err
		}
		return renderedExport{
			Extension:   "zip",
			ContentType: contentTypeZIP,
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
	if !cfg.IncludeData && !cfg.IncludeImages && !cfg.IncludeStatus {
		return batchExportConfig{}, apperr.New(apperr.KindInvalidArgument, "至少选择采集数据、运行状态或图片中的一项")
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

func (p *Processor) renderDeviceBatchZIP(ctx context.Context, job Job, cfg batchExportConfig, output io.Writer) error {
	validator := &Service{queries: p.queries, devices: p.devices}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := validator.validateDeviceBatch(ctx, job.RequestedBy, job.WorkspaceID, job.ResourceID, job.ExportType, raw, job.RequestedByAdmin != nil); err != nil {
		return err
	}

	if cfg.IncludeStatus || len(cfg.NodeTargets) > 0 && cfg.NodeTargets[0].Kind == "gateway_node" {
		return p.renderIndexedNodeZIP(ctx, cfg, output)
	}
	zw := zip.NewWriter(output)
	defer zw.Close()
	quality := make([]qualityReportRow, 0)
	if err := writeBytesFile(zw, "README.txt", []byte("IES Watch 生态感知云平台 · 数据导出\n时间均为北京时间（+08:00）；generation-report.csv 仅描述本次文件生成情况。\n")); err != nil {
		return err
	}
	gatewayAssetNo := ""
	if cfg.GatewayID != "" {
		gatewayID, err := uuid.Parse(cfg.GatewayID)
		if err != nil {
			return err
		}
		gateway, err := p.devices.GetAsset(ctx, gatewayID)
		if err != nil {
			return err
		}
		gatewayAssetNo = gateway.AssetNo
		var gatewayCSV bytes.Buffer
		writer := csv.NewWriter(&gatewayCSV)
		_ = writer.Write([]string{"gateway_asset_no", "gateway_name"})
		_ = writer.Write([]string{gatewayAssetNo, cfg.GatewayName})
		writer.Flush()
		if err := writer.Error(); err != nil {
			return err
		}
		if err := writeBytesFile(zw, "gateway.csv", gatewayCSV.Bytes()); err != nil {
			return err
		}
	}
	var deviceIndex bytes.Buffer
	deviceWriter := csv.NewWriter(&deviceIndex)
	if err := deviceWriter.Write([]string{"asset_no", "device_name", "device_type", "folder"}); err != nil {
		return err
	}
	seen := map[string]struct{}{}
	for index, rawID := range cfg.DeviceIDs {
		id, err := uuid.Parse(strings.TrimSpace(rawID))
		if err != nil || id == uuid.Nil {
			return apperr.New(apperr.KindInvalidArgument, "invalid device_id in batch export")
		}
		if _, ok := seen[id.String()]; ok {
			continue
		}
		seen[id.String()] = struct{}{}
		device, err := p.devices.GetAsset(ctx, id)
		if err != nil {
			return err
		}
		if name, ok := cfg.NodeNames[id.String()]; ok {
			device.Name = name
		}
		folder := "."
		if len(cfg.DeviceIDs) > 1 {
			folder = safeArchiveSegment(device.AssetNo)
			if folder == "" {
				folder = fmt.Sprintf("device-%d", index+1)
			}
		}
		if err := deviceWriter.Write([]string{device.AssetNo, device.Name, device.DeviceType, folder}); err != nil {
			return err
		}

		if cfg.IncludeData {
			series, telemetryErr := p.queryDeviceTelemetryRaw(ctx, id, cfg.StartTime, cfg.EndTime)
			if telemetryErr != nil {
				quality = append(quality, qualityReportRow{device.AssetNo, "telemetry", "遥测数据", "missing", 0, telemetryErr.Error()})
			} else {
				columns := []exportCSVColumn{{"asset_no", device.AssetNo}}
				if gatewayAssetNo != "" {
					columns = append(columns, exportCSVColumn{"gateway_asset_no", gatewayAssetNo})
				}
				if name, ok := cfg.NodeNames[id.String()]; ok {
					columns = append(columns, exportCSVColumn{"node_index", strconv.FormatInt(cfg.NodeIndices[id.String()], 10)}, exportCSVColumn{"node_name", name})
				}
				body, metadata, count, err := renderWideTelemetryCSV(series, columns...)
				if err != nil {
					return err
				}
				if err := writeBytesFile(zw, path.Join(folder, "data.csv"), body); err != nil {
					return err
				}
				if err := writeMetadataCSV(zw, path.Join(folder, "metadata.csv"), metadata); err != nil {
					return err
				}
				quality = append(quality, qualityReportRow{device.AssetNo, "telemetry", "遥测数据", "packed", count, ""})
			}
		}

		if cfg.IncludeImages {
			items, mediaErr := p.queryDeviceMediaAll(ctx, device, cfg.StartTime, cfg.EndTime)
			if mediaErr != nil {
				quality = append(quality, qualityReportRow{device.AssetNo, "images", "图片", "missing", 0, mediaErr.Error()})
			} else {
				packed := make([]mediaExportItem, 0, len(items))
				used := map[string]int{}
				for _, item := range items {
					result, getErr := fetchMediaObject(ctx, p.store, p.httpClient, item.ObjectKey)
					if getErr != nil || result.Body == nil {
						detail := "对象存储读取失败"
						if getErr != nil {
							detail = getErr.Error()
						}
						quality = append(quality, qualityReportRow{device.AssetNo, "image", item.CameraName + " " + exportTime(item.CapturedAt), "missing", 0, detail})
						continue
					}
					archivePath := mediaArchivePath(folder, item, used)
					if writeErr := writeObjectFile(zw, archivePath, result.Body); writeErr != nil {
						_ = result.Body.Close()
						return writeErr
					}
					_ = result.Body.Close()
					item.ArchivePath = archivePath
					recordPackedImage(ctx)
					packed = append(packed, item)
				}
				if err := writeMediaManifestCSVNamed(zw, path.Join(folder, "image-index.csv"), packed); err != nil {
					return err
				}
				quality = append(quality, qualityReportRow{device.AssetNo, "images", "图片", "packed", len(packed), ""})
			}
		}
	}
	if err := validateBatchReadResults(quality); err != nil {
		return err
	}
	deviceWriter.Flush()
	if err := deviceWriter.Error(); err != nil {
		return err
	}
	if err := writeBytesFile(zw, "manifest.csv", deviceIndex.Bytes()); err != nil {
		return err
	}
	if err := writeQualityReportCSV(zw, quality); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "close batch export zip", err)
	}
	return nil
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
	points, err := p.queryExportTelemetry(ctx, source, platform.TelemetryQuery{Binding: binding, Start: start, End: end, Limit: p.cfg.MaxRows})
	if err != nil {
		return telemetrySeries{}, err
	}
	unit := ""
	if stream.Unit != nil {
		unit = *stream.Unit
	}
	return telemetrySeries{DataStreamID: stream.ID, DeviceID: stream.DeviceID, Code: stream.Code, Name: stream.Name, Unit: unit, Points: points}, nil
}

func (p *Processor) renderDatasetZIP(ctx context.Context, job Job, output io.Writer) error {
	dataset, err := p.queries.GetDataset(ctx, job.ResourceID)
	if err != nil {
		return mapNotFoundOrInternal(err, "dataset not found")
	}
	sources, err := p.queries.ListDatasetSources(ctx, dataset.ID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list dataset sources", err)
	}

	zw := zip.NewWriter(output)
	defer zw.Close()
	if err := writeJSONFile(zw, "dataset.json", map[string]any{
		"name":        dataset.Name,
		"description": dataset.Description,
		"data_type":   dataset.DataType,
		"time_start":  pgTimeValue(dataset.TimeStart),
		"time_end":    pgTimeValue(dataset.TimeEnd),
		"status":      dataset.Status,
	}); err != nil {
		return err
	}

	start := pgTimeValue(dataset.TimeStart)
	end := pgTimeValue(dataset.TimeEnd)
	sourceRows := make([]datasetExportSource, 0, len(sources))
	mediaItems := make([]mediaExportItem, 0)
	usedPaths := map[string]int{}
	for _, source := range sources {
		entry := datasetExportSource{Type: source.SourceType}
		switch source.SourceType {
		case "device":
			asset, err := p.devices.GetAsset(ctx, source.SourceID)
			if err != nil {
				return err
			}
			entry.AssetNo, entry.DeviceName = asset.AssetNo, asset.Name
			series, err := p.queryTelemetry(ctx, "device", source.SourceID, start, end, p.cfg.MaxRows)
			if err != nil {
				return err
			}
			body, err := renderTelemetryCSV(series)
			if err != nil {
				return err
			}
			entry.File = uniqueArchivePath(path.Join("telemetry", safeArchiveSegment(asset.AssetNo), "data.csv"), usedPaths)
			if err := writeBytesFile(zw, entry.File, body); err != nil {
				return err
			}
			items, err := p.queryMedia(ctx, "device", source.SourceID, start, end, p.cfg.MaxRows, "")
			if err != nil {
				return err
			}
			mediaItems, err = p.writeMediaItems(ctx, zw, items, mediaItems, usedPaths)
			if err != nil {
				return err
			}
		case "data_stream":
			stream, err := p.queries.GetDataStream(ctx, source.SourceID)
			if err != nil {
				return mapNotFoundOrInternal(err, "data stream source not found")
			}
			asset, err := p.devices.GetAsset(ctx, stream.DeviceID)
			if err != nil {
				return err
			}
			entry.AssetNo, entry.DeviceName, entry.StreamCode = asset.AssetNo, asset.Name, stream.Code
			switch {
			case stream.Type == "telemetry":
				series, err := p.queryTelemetry(ctx, "data_stream", source.SourceID, start, end, p.cfg.MaxRows)
				if err != nil {
					return err
				}
				body, err := renderTelemetryCSV(series)
				if err != nil {
					return err
				}
				entry.File = uniqueArchivePath(path.Join("telemetry", safeArchiveSegment(asset.AssetNo), "stream-"+safeArchiveSegment(stream.Code)+".csv"), usedPaths)
				if err := writeBytesFile(zw, entry.File, body); err != nil {
					return err
				}
			case isMediaStreamType(stream.Type):
				items, err := p.queryMediaStream(ctx, asset.AssetNo, stream, start, end, p.cfg.MaxRows)
				if err != nil {
					return err
				}
				mediaItems, err = p.writeMediaItems(ctx, zw, items, mediaItems, usedPaths)
				if err != nil {
					return err
				}
			}
		}
		sourceRows = append(sourceRows, entry)
	}
	if err := writeSourcesCSV(zw, sourceRows); err != nil {
		return err
	}
	if len(mediaItems) > 0 {
		if err := writeMediaManifestCSVNamed(zw, "media/manifest.csv", mediaItems); err != nil {
			return err
		}
	}

	if err := zw.Close(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "close dataset export zip", err)
	}
	return nil
}

func (p *Processor) renderMediaZIP(ctx context.Context, job Job, cfg requestConfig, output io.Writer) error {
	items, err := p.queryMedia(ctx, job.ResourceType, job.ResourceID, cfg.StartTime, cfg.EndTime, cfg.Limit, cfg.MediaType)
	if err != nil {
		return err
	}

	zw := zip.NewWriter(output)
	defer zw.Close()

	usedPaths := map[string]int{}
	items, err = p.writeMediaItems(ctx, zw, items, nil, usedPaths)
	if err != nil {
		_ = zw.Close()
		return err
	}
	if err := writeMediaManifestCSV(zw, items); err != nil {
		_ = zw.Close()
		return err
	}
	if err := zw.Close(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "close media export zip", err)
	}
	return nil
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

		archivePath := mediaArchivePath(safeArchiveSegment(items[i].AssetNo), items[i], usedPaths)
		items[i].ArchivePath = archivePath
		result, err := fetchMediaObject(ctx, p.store, p.httpClient, items[i].ObjectKey)
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
		recordPackedImage(ctx)
	}
	return existing, nil
}

func fetchMediaObject(ctx context.Context, store objectstore.Store, client *http.Client, objectKey string) (objectstore.GetResult, error) {
	raw := strings.TrimSpace(objectKey)
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return store.Get(ctx, raw)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return objectstore.GetResult{}, err
	}
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(req)
	if err != nil {
		return objectstore.GetResult{}, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_ = response.Body.Close()
		return objectstore.GetResult{}, fmt.Errorf("download media URL: HTTP status %s", response.Status)
	}
	return objectstore.GetResult{Body: response.Body, ContentType: response.Header.Get("Content-Type")}, nil
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
		device, err := p.devices.GetAsset(ctx, resourceID)
		if err != nil {
			return nil, err
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
			streamItems, err := p.queryMediaStream(ctx, device.AssetNo, stream, start, end, remainingLimit(limit, len(items)))
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
		asset, err := p.devices.GetAsset(ctx, stream.DeviceID)
		if err != nil {
			return nil, err
		}
		return p.queryMediaStream(ctx, asset.AssetNo, stream, start, end, limit)
	default:
		return nil, apperr.New(apperr.KindInvalidArgument, "media export requires device, data_stream or media resource")
	}
}

func (p *Processor) queryMediaStream(ctx context.Context, assetNo string, stream sqlc.DataStream, start time.Time, end time.Time, limit int) ([]mediaExportItem, error) {
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
	result, err := p.runtime.QueryMedia(ctx, source, platform.MediaQuery{
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
	return appendMediaItems(nil, assetNo, stream, result.Items), nil
}

func (p *Processor) queryDeviceMediaAll(ctx context.Context, device device.Device, start, end time.Time) ([]mediaExportItem, error) {
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
		records, err := p.queryExportMedia(ctx, source, platform.MediaQuery{Binding: binding, Start: start, End: end, PageSize: pageSize, MediaType: stream.Type})
		if err != nil {
			return nil, err
		}
		items = appendMediaItems(items, device.AssetNo, stream, records)
	}
	return items, nil
}

func appendMediaItems(items []mediaExportItem, assetNo string, stream sqlc.DataStream, records []platform.MediaRecord) []mediaExportItem {
	for _, record := range records {
		items = append(items, mediaExportItem{
			DataStreamID: stream.ID, AssetNo: assetNo, StreamCode: stream.Code, CameraName: stream.Name,
			MediaID: record.ID, MediaType: record.MediaType, CapturedAt: record.CapturedAt, ObjectKey: record.ObjectKey,
		})
	}
	return items
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
	var asset device.Device
	var stream sqlc.DataStream
	var err error
	switch resourceType {
	case "device":
		asset, err = p.devices.GetAsset(ctx, resourceID)
		if err != nil {
			return nil, err
		}
		if asset.DeviceType == "gateway" {
			return p.queryGatewayTelemetry(ctx, asset, start, end)
		}
	case "data_stream":
		stream, err = p.queries.GetDataStream(ctx, resourceID)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "data stream not found")
		}
		if stream.Type != "telemetry" || stream.Status != "active" {
			return nil, apperr.New(apperr.KindInvalidArgument, "data stream is not active telemetry")
		}
		asset, err = p.devices.GetAsset(ctx, stream.DeviceID)
		if err != nil {
			return nil, err
		}
	default:
		return nil, apperr.New(apperr.KindInvalidArgument, "telemetry export requires device or data_stream resource")
	}
	if p.telemetry != nil {
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
			if series.Error != "" {
				return nil, apperr.New(apperr.KindDataSource, "telemetry export failed: "+series.Error)
			}
			points := make([]platform.TelemetryPoint, 0, len(series.Points))
			for _, point := range series.Points {
				points = append(points, platform.TelemetryPoint{Timestamp: point.Timestamp, Value: point.Value, Quality: point.Quality})
			}
			unit := ""
			if series.Unit != nil {
				unit = *series.Unit
			}
			items = append(items, telemetrySeries{
				DataStreamID: series.DataStreamID, DeviceID: result.DeviceID,
				AssetNo: asset.AssetNo, DeviceName: asset.Name,
				Code: series.Code, Name: series.Name, Unit: unit, Points: points,
			})
		}
		return items, nil
	}

	streams := []sqlc.DataStream{stream}
	if resourceType == "device" {
		streams, err = p.queries.ListDataStreamsByDevice(ctx, asset.ID)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "list data streams", err)
		}
	}
	series := make([]telemetrySeries, 0, len(streams))
	for _, stream := range streams {
		if stream.Type != "telemetry" || stream.Status != "active" {
			continue
		}
		item, err := p.queryTelemetryStream(ctx, stream, start, end, limit)
		if err != nil {
			return nil, err
		}
		item.AssetNo, item.DeviceName = asset.AssetNo, asset.Name
		series = append(series, item)
	}
	return series, nil
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
	result, err := p.runtime.QueryTelemetry(ctx, source, platform.TelemetryQuery{
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
	return renderGatewayWideCSV(series)
}

type telemetryMetadataRow struct {
	Code string
	Name string
	Unit string
	Type string
}

type exportCSVColumn struct{ name, value string }

func renderWideTelemetryCSV(series []telemetrySeries, identity ...exportCSVColumn) ([]byte, []telemetryMetadataRow, int, error) {
	columns := make([]telemetrySeries, len(series))
	copy(columns, series)
	sort.Slice(columns, func(i, j int) bool { return columns[i].Code < columns[j].Code })
	metadata := make([]telemetryMetadataRow, 0, len(columns))
	byTimestamp := map[time.Time]map[string]platform.TelemetryPoint{}
	for _, item := range columns {
		metadata = append(metadata, telemetryMetadataRow{Code: item.Code, Name: item.Name, Unit: item.Unit, Type: "telemetry"})
		for _, point := range item.Points {
			key := point.Timestamp.UTC()
			if byTimestamp[key] == nil {
				byTimestamp[key] = map[string]platform.TelemetryPoint{}
			}
			byTimestamp[key][item.Code] = point
		}
	}
	timestamps := make([]time.Time, 0, len(byTimestamp))
	for timestamp := range byTimestamp {
		timestamps = append(timestamps, timestamp)
	}
	sort.Slice(timestamps, func(i, j int) bool { return timestamps[i].Before(timestamps[j]) })
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	header := []string{"ts"}
	for _, item := range columns {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = item.Code
		}
		header = append(header, name)
	}
	for _, column := range identity {
		header = append(header, column.name)
	}
	if err := writer.Write(header); err != nil {
		return nil, nil, 0, apperr.Wrap(apperr.KindInternal, "write wide telemetry header", err)
	}
	for _, timestamp := range timestamps {
		row := []string{exportTime(timestamp)}
		for _, item := range columns {
			point, ok := byTimestamp[timestamp][item.Code]
			if !ok {
				row = append(row, "")
				continue
			}
			row = append(row, strconv.FormatFloat(point.Value, 'f', -1, 64))
		}
		for _, column := range identity {
			row = append(row, column.value)
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
	if err := writer.Write([]string{"asset_no", "scope", "name", "status", "packed_count", "detail"}); err != nil {
		return err
	}
	for _, row := range rows {
		if err := writer.Write([]string{row.AssetNo, row.Scope, row.Name, row.Status, strconv.Itoa(row.Count), row.Detail}); err != nil {
			return err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return err
	}
	return writeBytesFile(zw, "generation-report.csv", buf.Bytes())
}

func (p *Processor) renderCarbonStationZIP(ctx context.Context, job Job, cfg carbonStationExportConfig, output io.Writer) error {
	device, err := p.devices.GetAsset(ctx, job.ResourceID)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(output)
	defer zw.Close()
	if err := writeBytesFile(zw, "README.txt", []byte("IES Watch 生态感知云平台 · 碳汇站数据导出\n时间均为北京时间（+08:00）；空文件表示所选范围内没有对应数据。\n")); err != nil {
		return err
	}
	var manifest bytes.Buffer
	manifestWriter := csv.NewWriter(&manifest)
	header := []string{"asset_no", "device_name", "node_id", "field", "content", "file"}
	if cfg.NodeNames != nil {
		header = append(header, "node_name")
	}
	if err := manifestWriter.Write(header); err != nil {
		return err
	}
	report := make([]qualityReportRow, 0)
	metadata := []telemetryMetadataRow{
		{Code: "asset_no", Name: device.AssetNo, Type: "string"},
		{Code: "device_type", Name: device.DeviceType, Type: "string"},
		{Code: "start_time", Name: exportTime(cfg.StartTime), Type: "datetime"},
		{Code: "end_time", Name: exportTime(cfg.EndTime), Type: "datetime"},
	}
	if err := writeMetadataCSV(zw, "metadata.csv", metadata); err != nil {
		return err
	}
	for _, nodeID := range cfg.NodeIDs {
		var rawPeriods []carbon.CarbonPeriodSummary
		if cfg.IncludeRawSamples {
			rawPeriods, err = carbonExportPeriods(ctx, p.dataSources.Carbon, device.ID, nodeID, cfg.StartTime, cfg.EndTime)
			if err != nil {
				return err
			}
		}
		for _, rawField := range cfg.Fields {
			field := strings.TrimSpace(rawField)
			folder := path.Join(safeArchiveSegment(device.AssetNo), fmt.Sprintf("node-%d", nodeID), safeArchiveSegment(field))
			if cfg.IncludeFlux {
				points, queryErr := p.dataSources.Carbon.CarbonFlux(ctx, job.ResourceID, nodeID, field, cfg.StartTime, cfg.EndTime)
				if queryErr != nil {
					return queryErr
				}
				body, renderErr := renderCarbonFluxCSV(device.AssetNo, points.Points)
				if renderErr != nil {
					return renderErr
				}
				name := path.Join(folder, "flux.csv")
				if cfg.NodeNames != nil {
					body, renderErr = appendNodeColumns(body, "", cfg.NodeNames[strconv.Itoa(nodeID)], false)
					if renderErr != nil {
						return renderErr
					}
				}
				if err := writeBytesFile(zw, name, body); err != nil {
					return err
				}
				row := []string{device.AssetNo, device.Name, strconv.Itoa(nodeID), field, "flux", name}
				if cfg.NodeNames != nil {
					row = append(row, cfg.NodeNames[strconv.Itoa(nodeID)])
				}
				_ = manifestWriter.Write(row)
				report = append(report, qualityReportRow{device.AssetNo, fmt.Sprintf("node-%d/%s", nodeID, field), "通量", "generated", len(points.Points), ""})
			}
			if cfg.IncludeRawSamples {
				name := path.Join(folder, "raw-samples.csv")
				output, err := zw.Create(name)
				if err != nil {
					return err
				}
				var extra []exportCSVColumn
				if cfg.NodeNames != nil {
					extra = append(extra, exportCSVColumn{"node_name", cfg.NodeNames[strconv.Itoa(nodeID)]})
				}
				count, err := writeCarbonRawCSV(ctx, output, p.dataSources.Carbon, device.ID, device.AssetNo, nodeID, field, rawPeriods, extra...)
				if err != nil {
					return err
				}
				row := []string{device.AssetNo, device.Name, strconv.Itoa(nodeID), field, "raw_samples", name}
				if cfg.NodeNames != nil {
					row = append(row, cfg.NodeNames[strconv.Itoa(nodeID)])
				}
				_ = manifestWriter.Write(row)
				report = append(report, qualityReportRow{device.AssetNo, fmt.Sprintf("node-%d/%s", nodeID, field), "原始采样", "generated", count, ""})
			}
		}
	}
	manifestWriter.Flush()
	if err := manifestWriter.Error(); err != nil {
		return err
	}
	if err := writeBytesFile(zw, "manifest.csv", manifest.Bytes()); err != nil {
		return err
	}
	if err := writeQualityReportCSV(zw, report); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return apperr.Wrap(apperr.KindInternal, "close carbon export zip", err)
	}
	return nil
}

func renderCarbonFluxCSV(assetNo string, points []carbon.CarbonFluxPoint) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"asset_no", "node_id", "period", "period_at", "field", "nee", "er", "gpp", "unit"}); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "write carbon flux csv header", err)
	}
	for _, point := range points {
		if err := writer.Write([]string{
			assetNo, strconv.Itoa(point.NodeID), point.Period, exportTime(point.PeriodAt), point.Field,
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

func carbonFloat(value *float64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatFloat(*value, 'f', -1, 64)
}

type datasetExportSource struct{ Type, AssetNo, DeviceName, StreamCode, File string }

func writeSourcesCSV(zw *zip.Writer, sources []datasetExportSource) error {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"source_type", "asset_no", "device_name", "stream_code", "file"}); err != nil {
		return apperr.Wrap(apperr.KindInternal, "write dataset sources header", err)
	}
	for _, source := range sources {
		if err := writer.Write([]string{source.Type, source.AssetNo, source.DeviceName, source.StreamCode, source.File}); err != nil {
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
	if err := writer.Write([]string{"asset_no", "stream_code", "camera_name", "media_type", "captured_at", "archive_path"}); err != nil {
		return apperr.Wrap(apperr.KindInternal, "write media manifest header", err)
	}
	for _, item := range items {
		if err := writer.Write([]string{
			item.AssetNo,
			item.StreamCode,
			item.CameraName,
			item.MediaType,
			exportTime(item.CapturedAt),
			item.ArchivePath,
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
	method := uint16(zip.Deflate)
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4":
		method = zip.Store
	}
	file, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: method})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "create "+name, err)
	}
	if _, err := io.Copy(file, reader); err != nil {
		return apperr.Wrap(apperr.KindInternal, "write "+name, err)
	}
	return nil
}

func mediaArchivePath(folder string, item mediaExportItem, used map[string]int) string {
	cameraName := safeArchiveSegment(item.CameraName)
	if cameraName == "" {
		cameraName = "图片"
	}
	filename := "media"
	if !item.CapturedAt.IsZero() {
		filename = item.CapturedAt.In(exportLocation).Format("2006-01-02_15-04-05.999999999")
	}
	objectPath := item.ObjectKey
	if parsed, err := url.Parse(item.ObjectKey); err == nil {
		objectPath = parsed.Path
	}
	ext := strings.ToLower(filepath.Ext(objectPath))
	if ext == "" || strings.Contains(ext, "/") || strings.Contains(ext, "\\") {
		ext = ".bin"
	}
	return uniqueArchivePath(path.Join(folder, cameraName, filename+ext), used)
}

func uniqueArchivePath(base string, used map[string]int) string {
	if used[base] == 0 {
		used[base] = 1
		return base
	}
	ext := path.Ext(base)
	for suffix := used[base] + 1; ; suffix++ {
		candidate := strings.TrimSuffix(base, ext) + "_" + strconv.Itoa(suffix) + ext
		if used[candidate] == 0 {
			used[base], used[candidate] = suffix, 1
			return candidate
		}
	}
}

func safeArchiveSegment(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for _, r := range value {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	return strings.Trim(b.String(), "_")
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

func (p *Processor) renderIndexedNodeZIP(ctx context.Context, cfg batchExportConfig, output io.Writer) error {
	gatewayID, err := uuid.Parse(cfg.GatewayID)
	if err != nil {
		return err
	}
	nodes, err := p.devices.ListGatewayNodes(ctx, gatewayID)
	if err != nil {
		return err
	}
	selected := map[string]bool{}
	for _, target := range cfg.NodeTargets {
		selected[target.Key()] = true
	}
	zw := zip.NewWriter(output)
	defer zw.Close()
	report := []qualityReportRow{}
	statusSeries := []telemetrySeries{}
	gateway, err := p.devices.GetAsset(ctx, gatewayID)
	if err != nil {
		return err
	}
	type archiveNode struct {
		Index          int    `json:"node_index"`
		Name           string `json:"node_name"`
		CurrentAssetNo string `json:"current_node_asset_no,omitempty"`
		Folder         string `json:"folder,omitempty"`
	}
	exportedNodes := make([]archiveNode, 0, len(selected))
	if err := writeBytesFile(zw, "README.txt", []byte("IES Watch 生态感知云平台 · 节点数据导出\n时间均为北京时间（+08:00）；节点序号用于识别同一网关下的历史数据，当前节点资产编号和 SN 不代表历史记录的硬件归属。\n")); err != nil {
		return err
	}
	for _, node := range nodes {
		if !selected[node.Key] {
			continue
		}
		delete(selected, node.Key)
		series := []telemetrySeries{}
		name := node.Name
		if snapshot, ok := cfg.NodeNames[node.Key]; ok {
			name = snapshot
		}
		index := *node.Target.NodeIndex
		entry := archiveNode{Index: index, Name: name, CurrentAssetNo: node.AssetNo}
		for _, stream := range node.Streams {
			purpose := stream.Purpose
			wantData := cfg.IncludeData && purpose == "measurement"
			wantStatus := cfg.IncludeStatus && purpose != "measurement"
			if !wantData && !wantStatus {
				continue
			}
			row, err := p.queries.GetDataStream(ctx, stream.ID)
			if err != nil {
				return err
			}
			item, err := p.queryTelemetryStreamFull(ctx, row, cfg.StartTime, cfg.EndTime)
			if err != nil {
				return err
			}
			if wantStatus {
				item.NodeKey, item.NodeName, item.NodeIndex, item.CurrentNodeSN = node.Key, name, node.Target.NodeIndex, node.NodeSN
				item.AssetNo = node.AssetNo
				item.Code = stream.Code
				item.MetricName = strings.TrimPrefix(item.Name, fmt.Sprintf("节点 %d · ", index))
				statusSeries = append(statusSeries, item)
			} else {
				series = append(series, item)
			}
		}
		if cfg.IncludeData {
			entry.Folder = safeArchiveSegment(node.AssetNo)
			if entry.Folder == "" {
				entry.Folder = strings.TrimPrefix(fmt.Sprintf("%s-node-%d", safeArchiveSegment(gateway.AssetNo), index), "-")
			}
			body, metadata, count, err := renderWideTelemetryCSV(series,
				exportCSVColumn{"gateway_asset_no", gateway.AssetNo},
				exportCSVColumn{"current_node_asset_no", node.AssetNo},
				exportCSVColumn{"node_index", strconv.Itoa(index)},
				exportCSVColumn{"node_name", name},
			)
			if err != nil {
				return err
			}
			if err := writeBytesFile(zw, path.Join(entry.Folder, "data.csv"), body); err != nil {
				return err
			}
			if err := writeMetadataCSV(zw, path.Join(entry.Folder, "metadata.csv"), metadata); err != nil {
				return err
			}
			assetNo := node.AssetNo
			if assetNo == "" {
				assetNo = gateway.AssetNo
			}
			report = append(report, qualityReportRow{assetNo, entry.Folder, name, "packed", count, ""})
		}
		exportedNodes = append(exportedNodes, entry)
	}
	if cfg.IncludeStatus {
		streams, err := p.queries.ListDataStreamsByDevice(ctx, gatewayID)
		if err != nil {
			return err
		}
		nodeStreams := map[uuid.UUID]bool{}
		for _, node := range nodes {
			for _, stream := range node.Streams {
				nodeStreams[stream.ID] = true
			}
		}
		for _, stream := range streams {
			if stream.Status != "active" || stream.Type != "telemetry" || stream.Purpose == "measurement" || nodeStreams[stream.ID] {
				continue
			}
			item, err := p.queryTelemetryStreamFull(ctx, stream, cfg.StartTime, cfg.EndTime)
			if err != nil {
				return err
			}
			item.NodeKey = gatewayID.String()
			item.Code = strings.TrimPrefix(item.Code, "lora_gateway_")
			item.MetricName = strings.TrimPrefix(item.Name, "网关 · ")
			statusSeries = append(statusSeries, item)
		}
		body, err := renderV2StatusCSV(statusSeries, gateway.AssetNo)
		if err != nil {
			return err
		}
		if err := writeBytesFile(zw, "运行状态.csv", body); err != nil {
			return err
		}
		report = append(report, qualityReportRow{gateway.AssetNo, "status", "运行状态", "packed", len(gatewayWideRows(statusSeries)) - 1, ""})
	}
	if len(selected) > 0 {
		return apperr.New(apperr.KindInvalidArgument, "selected node no longer exists")
	}
	if err := writeJSONFile(zw, "gateway.json", map[string]any{
		"gateway_asset_no": gateway.AssetNo, "gateway_name": gateway.Name, "nodes": exportedNodes,
	}); err != nil {
		return err
	}
	if err := writeQualityReportCSV(zw, report); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return nil
}

func (p *Processor) SetSettings(service *systemsettings.Service) { p.settings = service }
