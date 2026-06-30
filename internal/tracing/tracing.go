package tracing

import (
	"context"
	"log/slog"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"
	nooptrace "go.opentelemetry.io/otel/trace/noop"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

const instrumentationName = "thcpn-gin"

func Init(ctx context.Context, cfg config.TracingConfig, logger *slog.Logger) (func(context.Context) error, error) {
	cfg = normalizeConfig(cfg)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	if !cfg.Enabled || cfg.Exporter == "noop" {
		otel.SetTracerProvider(nooptrace.NewTracerProvider())
		return func(context.Context) error { return nil }, nil
	}

	exporter, err := newExporter(ctx, cfg)
	if err != nil {
		return nil, err
	}
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(cfg.ServiceName),
		)),
	)
	otel.SetTracerProvider(provider)
	if logger != nil {
		logger.Info("tracing initialized", slog.String("exporter", cfg.Exporter), slog.String("service_name", cfg.ServiceName))
	}
	return provider.Shutdown, nil
}

func Start(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	return otel.Tracer(instrumentationName).Start(ctx, name, trace.WithAttributes(attrs...))
}

func End(span trace.Span, err error) {
	if span == nil {
		return
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, apperr.MessageOf(err))
	}
	span.End()
}

func normalizeConfig(cfg config.TracingConfig) config.TracingConfig {
	cfg.Exporter = strings.TrimSpace(cfg.Exporter)
	if cfg.Exporter == "" {
		cfg.Exporter = "stdout"
	}
	cfg.ServiceName = strings.TrimSpace(cfg.ServiceName)
	if cfg.ServiceName == "" {
		cfg.ServiceName = "thcpn-gin"
	}
	cfg.Endpoint = strings.TrimSpace(cfg.Endpoint)
	return cfg
}

func newExporter(ctx context.Context, cfg config.TracingConfig) (sdktrace.SpanExporter, error) {
	switch cfg.Exporter {
	case "stdout":
		return stdouttrace.New(stdouttrace.WithPrettyPrint())
	case "otlp":
		opts := make([]otlptracehttp.Option, 0, 2)
		if cfg.Endpoint != "" {
			if strings.Contains(cfg.Endpoint, "://") {
				opts = append(opts, otlptracehttp.WithEndpointURL(cfg.Endpoint))
			} else {
				opts = append(opts, otlptracehttp.WithEndpoint(cfg.Endpoint))
			}
		}
		if cfg.Insecure {
			opts = append(opts, otlptracehttp.WithInsecure())
		}
		return otlptracehttp.New(ctx, opts...)
	default:
		return nil, apperr.New(apperr.KindInvalidArgument, "unsupported tracing exporter")
	}
}
