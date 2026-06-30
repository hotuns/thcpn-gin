package tracing

import (
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"

	"thcpn-gin/internal/config"
)

func TestInitDisabledInstallsNoopProvider(t *testing.T) {
	shutdown, err := Init(t.Context(), config.TracingConfig{
		Enabled:     false,
		ServiceName: "test-service",
		Exporter:    "stdout",
	}, nil)
	if err != nil {
		t.Fatalf("init tracing: %v", err)
	}
	defer shutdown(t.Context())

	ctx, span := otel.Tracer("test").Start(t.Context(), "test.span")
	defer span.End()
	if trace.SpanContextFromContext(ctx).IsValid() {
		t.Fatal("expected noop tracing to produce an invalid span context")
	}
}

func TestNormalizeConfigDefaults(t *testing.T) {
	cfg := normalizeConfig(config.TracingConfig{})
	if cfg.ServiceName != "thcpn-gin" {
		t.Fatalf("unexpected service name: %q", cfg.ServiceName)
	}
	if cfg.Exporter != "stdout" {
		t.Fatalf("unexpected exporter: %q", cfg.Exporter)
	}
}
