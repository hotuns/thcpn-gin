package app

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"thcpn-gin/internal/metrics"
)

func TestHealthz(t *testing.T) {
	router, err := NewRouter(Dependencies{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("new router: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}

	var body statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("expected ok status, got %q", body.Status)
	}
}

func TestReadyzWithoutDependencies(t *testing.T) {
	router, err := NewRouter(Dependencies{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("new router: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, rec.Code)
	}
	if rec.Header().Get("X-Request-ID") == "" {
		t.Fatal("expected request id header")
	}
}

func TestMetricsEndpoint(t *testing.T) {
	router, err := NewRouter(Dependencies{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("new router: %v", err)
	}

	healthReq := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	healthRec := httptest.NewRecorder()
	router.ServeHTTP(healthRec, healthReq)
	if healthRec.Code != http.StatusOK {
		t.Fatalf("expected health status %d, got %d", http.StatusOK, healthRec.Code)
	}
	metrics.ObserveDataSourceQuery("postgres", "telemetry", "columns", nil, 10*time.Millisecond)
	metrics.ObserveExportJob("telemetry_csv", "success", 10*time.Millisecond)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "http_requests_total") {
		t.Fatalf("expected http_requests_total metric, got:\n%s", body)
	}
	if !strings.Contains(body, `path="/healthz"`) {
		t.Fatalf("expected healthz path label, got:\n%s", body)
	}
	if !strings.Contains(body, "datasource_query_duration_seconds") {
		t.Fatalf("expected datasource_query_duration_seconds metric, got:\n%s", body)
	}
	if !strings.Contains(body, "export_jobs_total") {
		t.Fatalf("expected export_jobs_total metric, got:\n%s", body)
	}
}
