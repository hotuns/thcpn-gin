package metrics

import (
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"thcpn-gin/internal/apperr"
)

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total number of HTTP requests handled by the API.",
	}, []string{"method", "path", "status"})

	httpRequestDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path", "status"})

	dataSourceQueryDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "datasource_query_duration_seconds",
		Help:    "Device data source query duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"source_type", "operation", "payload_type", "result"})

	dataSourceErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "datasource_errors_total",
		Help: "Total number of device data source query errors.",
	}, []string{"source_type", "operation", "payload_type", "error_kind"})

	telemetryBatchSize = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "datasource_telemetry_batch_streams",
		Help:    "Number of telemetry streams requested per batch.",
		Buckets: []float64{1, 2, 4, 8, 16, 32, 64},
	}, []string{"source_type"})

	telemetryBatchSourceScans = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "datasource_telemetry_batch_source_scans",
		Help:    "Number of source table scans performed per telemetry batch.",
		Buckets: []float64{0, 1, 2, 4, 8, 16},
	}, []string{"source_type"})

	telemetryBatchRowsRead = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "datasource_telemetry_batch_rows_read",
		Help:    "Number of source rows read per telemetry batch.",
		Buckets: prometheus.ExponentialBuckets(100, 5, 8),
	}, []string{"source_type"})

	telemetryBatchReturnedPoints = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "datasource_telemetry_batch_returned_points",
		Help:    "Number of telemetry points returned per batch.",
		Buckets: prometheus.ExponentialBuckets(100, 5, 8),
	}, []string{"source_type"})

	telemetryBatchSampledSeries = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "datasource_telemetry_batch_sampled_series",
		Help:    "Number of adaptively sampled series per telemetry batch.",
		Buckets: []float64{0, 1, 2, 4, 8, 16, 32, 64},
	}, []string{"source_type"})

	exportJobsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "export_jobs_total",
		Help: "Total number of export jobs handled by the worker.",
	}, []string{"export_type", "status"})

	exportJobDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "export_job_duration_seconds",
		Help:    "Export job processing duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"export_type", "status"})
)

func ObserveHTTPRequest(method string, path string, status int, duration time.Duration) {
	method = labelValue(method, "unknown")
	path = labelValue(path, "unmatched")
	statusLabel := strconv.Itoa(status)
	httpRequestsTotal.WithLabelValues(method, path, statusLabel).Inc()
	httpRequestDurationSeconds.WithLabelValues(method, path, statusLabel).Observe(duration.Seconds())
}

func ObserveDataSourceQuery(sourceType string, operation string, payloadType string, err error, duration time.Duration) {
	sourceType = labelValue(sourceType, "unknown")
	operation = labelValue(operation, "unknown")
	payloadType = labelValue(payloadType, "unknown")
	result := "success"
	if err != nil {
		result = "failure"
		errorKind := string(apperr.KindOf(err))
		if errorKind == "" {
			errorKind = "UNKNOWN"
		}
		dataSourceErrorsTotal.WithLabelValues(sourceType, operation, payloadType, errorKind).Inc()
	}
	dataSourceQueryDurationSeconds.WithLabelValues(sourceType, operation, payloadType, result).Observe(duration.Seconds())
}

func ObserveTelemetryBatch(sourceType string, streamCount int, sourceScans int, rowsRead int, returnedPoints int, sampledSeries int) {
	sourceType = labelValue(sourceType, "unknown")
	telemetryBatchSize.WithLabelValues(sourceType).Observe(float64(streamCount))
	telemetryBatchSourceScans.WithLabelValues(sourceType).Observe(float64(sourceScans))
	telemetryBatchRowsRead.WithLabelValues(sourceType).Observe(float64(rowsRead))
	telemetryBatchReturnedPoints.WithLabelValues(sourceType).Observe(float64(returnedPoints))
	telemetryBatchSampledSeries.WithLabelValues(sourceType).Observe(float64(sampledSeries))
}

func ObserveExportJob(exportType string, status string, duration time.Duration) {
	exportType = labelValue(exportType, "unknown")
	status = labelValue(status, "unknown")
	exportJobsTotal.WithLabelValues(exportType, status).Inc()
	exportJobDurationSeconds.WithLabelValues(exportType, status).Observe(duration.Seconds())
}

func labelValue(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
