package logger

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"strings"

	"thcpn-gin/internal/config"
	"thcpn-gin/internal/platformlog"
)

func New(level string, format string) *slog.Logger {
	var slogLevel slog.Level
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		slogLevel = slog.LevelDebug
	case "warn", "warning":
		slogLevel = slog.LevelWarn
	case "error":
		slogLevel = slog.LevelError
	default:
		slogLevel = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{Level: slogLevel}
	var handler slog.Handler
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "text":
		handler = slog.NewTextHandler(os.Stdout, opts)
	default:
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}

	return slog.New(handler)
}

func Discard() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func NewManaged(level, format, service string, cfg config.LoggerConfig) (*slog.Logger, *platformlog.Store, error) {
	store, err := platformlog.Open(service, platformlog.Config{Directory: cfg.Directory, RetentionDays: cfg.RetentionDays, MaxTotalSizeMB: cfg.MaxTotalSizeMB, MaxFileSizeMB: cfg.MaxFileSizeMB, SQLiteIndex: cfg.SQLiteIndex})
	if err != nil {
		return New(level, format), nil, err
	}
	base := New(level, format).Handler()
	return slog.New(&managedHandler{base: base, store: store}), store, nil
}

type managedHandler struct {
	base  slog.Handler
	store *platformlog.Store
	attrs []slog.Attr
	group string
}

func (h *managedHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.base.Enabled(ctx, level)
}
func (h *managedHandler) Handle(ctx context.Context, record slog.Record) error {
	_ = h.base.Handle(ctx, record)
	fields := map[string]any{}
	for _, attr := range h.attrs {
		addField(fields, h.group, attr)
	}
	record.Attrs(func(attr slog.Attr) bool { addField(fields, h.group, attr); return true })
	entry := platformlog.Entry{Timestamp: record.Time.UTC(), Level: strings.ToUpper(record.Level.String()), Message: record.Message, Fields: fields}
	entry.ActorType = stringField(fields, "actor_type")
	entry.ActorID = stringField(fields, "actor_id")
	entry.ActorName = stringField(fields, "actor_name")
	entry.WorkspaceID = stringField(fields, "workspace_id")
	entry.RequestID = stringField(fields, "request_id")
	entry.TraceID = stringField(fields, "trace_id")
	entry.Method = stringField(fields, "method")
	entry.Path = stringField(fields, "path")
	entry.Status = intField(fields, "status")
	delete(fields, "actor_type")
	delete(fields, "actor_id")
	delete(fields, "actor_name")
	delete(fields, "workspace_id")
	delete(fields, "request_id")
	delete(fields, "trace_id")
	delete(fields, "method")
	delete(fields, "path")
	delete(fields, "status")
	if len(fields) == 0 {
		entry.Fields = nil
	}
	if err := h.store.Write(ctx, entry); err != nil {
		return nil
	}
	return nil
}
func (h *managedHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	clone := *h
	clone.attrs = append(append([]slog.Attr{}, h.attrs...), attrs...)
	return &clone
}
func (h *managedHandler) WithGroup(name string) slog.Handler {
	clone := *h
	if clone.group != "" {
		clone.group += "."
	}
	clone.group += name
	return &clone
}

func addField(fields map[string]any, group string, attr slog.Attr) {
	attr.Value = attr.Value.Resolve()
	key := attr.Key
	if group != "" {
		key = group + "." + key
	}
	if attr.Value.Kind() == slog.KindGroup {
		for _, child := range attr.Value.Group() {
			addField(fields, key, child)
		}
		return
	}
	value := attr.Value.Any()
	lowerKey := strings.ToLower(key)
	if sensitiveKey(key) {
		value = "[REDACTED]"
	} else if text, ok := value.(string); ok && strings.Contains(lowerKey, "email") {
		value = maskEmail(text)
	} else if text, ok := value.(string); ok && strings.Contains(lowerKey, "phone") {
		value = maskPhone(text)
	} else if err, ok := value.(error); ok {
		value = redactText(err.Error())
	} else if text, ok := value.(string); ok {
		value = redactText(text)
	}
	if _, err := json.Marshal(value); err != nil {
		value = redactText(strings.TrimSpace(attr.Value.String()))
	}
	fields[key] = value
}

func maskEmail(value string) string {
	parts := strings.SplitN(value, "@", 2)
	if len(parts) != 2 {
		return "[REDACTED]"
	}
	name := parts[0]
	if len(name) > 2 {
		name = name[:2] + "***"
	} else {
		name = "***"
	}
	return name + "@" + parts[1]
}
func maskPhone(value string) string {
	if len(value) < 7 {
		return "[REDACTED]"
	}
	return value[:3] + "****" + value[len(value)-4:]
}
func sensitiveKey(key string) bool {
	key = strings.ToLower(key)
	for _, part := range []string{"password", "secret", "token", "authorization", "cookie", "dsn", "code"} {
		if strings.Contains(key, part) {
			return true
		}
	}
	return false
}
func redactText(value string) string {
	lower := strings.ToLower(value)
	for _, marker := range []string{"authorization:", "password=", "token=", "secret=", "dsn="} {
		if i := strings.Index(lower, marker); i >= 0 {
			return value[:i+len(marker)] + "[REDACTED]"
		}
	}
	return value
}
func stringField(fields map[string]any, key string) string {
	value, _ := fields[key].(string)
	return value
}
func intField(fields map[string]any, key string) int {
	switch value := fields[key].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	}
	return 0
}
