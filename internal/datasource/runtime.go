package datasource

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
)

type SecretResolver interface {
	Resolve(ctx context.Context, ref string) (string, error)
}

type EnvSecretResolver struct{}

func (EnvSecretResolver) Resolve(_ context.Context, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if !strings.HasPrefix(ref, "env:") {
		return "", apperr.New(apperr.KindDataSource, "unsupported secret reference")
	}
	key := strings.TrimSpace(strings.TrimPrefix(ref, "env:"))
	if key == "" {
		return "", apperr.New(apperr.KindDataSource, "empty secret environment reference")
	}
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", apperr.New(apperr.KindDataSource, "data source secret is not configured")
	}
	return value, nil
}

type Runtime struct {
	resolver SecretResolver
}

func NewRuntime(resolver SecretResolver) *Runtime {
	if resolver == nil {
		resolver = EnvSecretResolver{}
	}
	return &Runtime{resolver: resolver}
}

func (r *Runtime) QueryTelemetry(ctx context.Context, source DataSource, req TelemetryQuery) (TelemetryResult, error) {
	if source.Status != "active" {
		return TelemetryResult{}, apperr.New(apperr.KindDataSource, "data source is not active")
	}
	if req.Binding.Status != "active" {
		return TelemetryResult{}, apperr.New(apperr.KindDataSource, "data stream binding is not active")
	}
	switch source.Type {
	case "postgres":
		return r.queryPostgresTelemetry(ctx, source, req)
	default:
		return TelemetryResult{}, apperr.New(apperr.KindDataSource, "unsupported telemetry data source type")
	}
}

func (r *Runtime) QueryMedia(ctx context.Context, source DataSource, req MediaQuery) (MediaResult, error) {
	if source.Status != "active" {
		return MediaResult{}, apperr.New(apperr.KindDataSource, "data source is not active")
	}
	if req.Binding.Status != "active" {
		return MediaResult{}, apperr.New(apperr.KindDataSource, "data stream binding is not active")
	}
	switch source.Type {
	case "postgres":
		return r.queryPostgresMedia(ctx, source, req)
	default:
		return MediaResult{}, apperr.New(apperr.KindDataSource, "unsupported media data source type")
	}
}

func (r *Runtime) queryPostgresTelemetry(ctx context.Context, source DataSource, req TelemetryQuery) (TelemetryResult, error) {
	if req.Binding.PayloadType != "columns" {
		return TelemetryResult{}, apperr.New(apperr.KindDataSource, "unsupported telemetry payload type")
	}
	if req.Limit <= 0 {
		return TelemetryResult{}, apperr.New(apperr.KindInvalidArgument, "limit must be greater than 0")
	}
	dsn, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return TelemetryResult{}, err
	}

	tableName, err := quotedTableName(req.Binding)
	if err != nil {
		return TelemetryResult{}, err
	}
	timeField, err := quotedRequiredIdentifier(req.Binding.TimeField, "time_field")
	if err != nil {
		return TelemetryResult{}, err
	}
	valueField, err := quotedRequiredIdentifier(req.Binding.ValueField, "value_field")
	if err != nil {
		return TelemetryResult{}, err
	}
	deviceKeyField, err := quotedRequiredIdentifier(req.Binding.DeviceKeyField, "device_key_field")
	if err != nil {
		return TelemetryResult{}, err
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return TelemetryResult{}, apperr.Wrap(apperr.KindDataSource, "connect data source", err)
	}
	defer pool.Close()

	query := fmt.Sprintf(
		`SELECT %s, %s::double precision FROM %s WHERE %s = $1 AND %s >= $2 AND %s <= $3 ORDER BY %s ASC LIMIT $4`,
		timeField,
		valueField,
		tableName,
		deviceKeyField,
		timeField,
		timeField,
		timeField,
	)
	rows, err := pool.Query(ctx, query, req.Binding.DeviceKeyValue, req.Start, req.End, req.Limit)
	if err != nil {
		return TelemetryResult{}, apperr.Wrap(apperr.KindDataSource, "query telemetry data source", err)
	}
	defer rows.Close()

	points := make([]TelemetryPoint, 0)
	for rows.Next() {
		var point TelemetryPoint
		if err := rows.Scan(&point.Timestamp, &point.Value); err != nil {
			return TelemetryResult{}, apperr.Wrap(apperr.KindDataSource, "scan telemetry point", err)
		}
		point.Quality = "valid"
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return TelemetryResult{}, apperr.Wrap(apperr.KindDataSource, "read telemetry points", err)
	}

	return TelemetryResult{Points: points}, nil
}

type mediaBindingConfig struct {
	IDField           string `json:"id_field"`
	ObjectKeyField    string `json:"object_key_field"`
	ThumbnailKeyField string `json:"thumbnail_key_field"`
	MediaTypeField    string `json:"media_type_field"`
	MediaType         string `json:"media_type"`
}

func (r *Runtime) queryPostgresMedia(ctx context.Context, source DataSource, req MediaQuery) (MediaResult, error) {
	if req.Binding.PayloadType != "media" {
		return MediaResult{}, apperr.New(apperr.KindDataSource, "unsupported media payload type")
	}
	if req.Page <= 0 {
		return MediaResult{}, apperr.New(apperr.KindInvalidArgument, "page must be greater than 0")
	}
	if req.PageSize <= 0 {
		return MediaResult{}, apperr.New(apperr.KindInvalidArgument, "page_size must be greater than 0")
	}
	cfg, err := parseMediaBindingConfig(req.Binding.QueryConfigJSON)
	if err != nil {
		return MediaResult{}, err
	}

	dsn, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return MediaResult{}, err
	}
	tableName, err := quotedTableName(req.Binding)
	if err != nil {
		return MediaResult{}, err
	}
	timeField, err := quotedRequiredIdentifier(req.Binding.TimeField, "time_field")
	if err != nil {
		return MediaResult{}, err
	}
	deviceKeyField, err := quotedRequiredIdentifier(req.Binding.DeviceKeyField, "device_key_field")
	if err != nil {
		return MediaResult{}, err
	}
	objectKeyFieldName := strings.TrimSpace(cfg.ObjectKeyField)
	if objectKeyFieldName == "" {
		objectKeyFieldName = req.Binding.ValueField
	}
	objectKeyField, err := quotedRequiredIdentifier(objectKeyFieldName, "object_key_field")
	if err != nil {
		return MediaResult{}, err
	}
	idFieldName := strings.TrimSpace(cfg.IDField)
	if idFieldName == "" {
		idFieldName = objectKeyFieldName
	}
	idField, err := quotedRequiredIdentifier(idFieldName, "id_field")
	if err != nil {
		return MediaResult{}, err
	}
	thumbnailField := "NULL::text"
	if strings.TrimSpace(cfg.ThumbnailKeyField) != "" {
		thumbnailField, err = quotedRequiredIdentifier(cfg.ThumbnailKeyField, "thumbnail_key_field")
		if err != nil {
			return MediaResult{}, err
		}
		thumbnailField += "::text"
	}
	mediaTypeField := ""
	if strings.TrimSpace(cfg.MediaTypeField) != "" {
		mediaTypeField, err = quotedRequiredIdentifier(cfg.MediaTypeField, "media_type_field")
		if err != nil {
			return MediaResult{}, err
		}
		mediaTypeField += "::text"
	}
	defaultMediaType := strings.TrimSpace(cfg.MediaType)
	if defaultMediaType == "" {
		defaultMediaType = strings.TrimSpace(req.MediaType)
	}
	if defaultMediaType == "" {
		defaultMediaType = "media"
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return MediaResult{}, apperr.Wrap(apperr.KindDataSource, "connect data source", err)
	}
	defer pool.Close()

	countQuery := fmt.Sprintf(
		`SELECT count(*) FROM %s WHERE %s = $1 AND %s >= $2 AND %s <= $3`,
		tableName,
		deviceKeyField,
		timeField,
		timeField,
	)
	var total int
	if err := pool.QueryRow(ctx, countQuery, req.Binding.DeviceKeyValue, req.Start, req.End).Scan(&total); err != nil {
		return MediaResult{}, apperr.Wrap(apperr.KindDataSource, "count media data source", err)
	}

	offset := (req.Page - 1) * req.PageSize
	args := []any{req.Binding.DeviceKeyValue, req.Start, req.End, req.PageSize, offset}
	mediaTypeExpr := mediaTypeField
	if mediaTypeExpr == "" {
		args = append(args, defaultMediaType)
		mediaTypeExpr = fmt.Sprintf("$%d::text", len(args))
	}
	query := fmt.Sprintf(
		`SELECT %s::text, %s, %s::text, %s, %s FROM %s WHERE %s = $1 AND %s >= $2 AND %s <= $3 ORDER BY %s DESC LIMIT $4 OFFSET $5`,
		idField,
		timeField,
		objectKeyField,
		thumbnailField,
		mediaTypeExpr,
		tableName,
		deviceKeyField,
		timeField,
		timeField,
		timeField,
	)
	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return MediaResult{}, apperr.Wrap(apperr.KindDataSource, "query media data source", err)
	}
	defer rows.Close()

	items := make([]MediaRecord, 0)
	for rows.Next() {
		var item MediaRecord
		if err := rows.Scan(&item.ID, &item.CapturedAt, &item.ObjectKey, &item.ThumbnailObjectKey, &item.MediaType); err != nil {
			return MediaResult{}, apperr.Wrap(apperr.KindDataSource, "scan media record", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return MediaResult{}, apperr.Wrap(apperr.KindDataSource, "read media records", err)
	}
	return MediaResult{Items: items, Total: total}, nil
}

func parseMediaBindingConfig(value json.RawMessage) (mediaBindingConfig, error) {
	if len(value) == 0 {
		return mediaBindingConfig{}, nil
	}
	var cfg mediaBindingConfig
	if err := json.Unmarshal(value, &cfg); err != nil {
		return mediaBindingConfig{}, apperr.New(apperr.KindInvalidArgument, "invalid media query_config")
	}
	return cfg, nil
}

func quotedTableName(binding DataStreamBinding) (string, error) {
	tableName, err := quotedRequiredIdentifier(binding.TableName, "table_name")
	if err != nil {
		return "", err
	}
	if binding.SchemaName == nil || strings.TrimSpace(*binding.SchemaName) == "" {
		return tableName, nil
	}
	schemaName, err := quotedRequiredIdentifier(*binding.SchemaName, "schema_name")
	if err != nil {
		return "", err
	}
	return schemaName + "." + tableName, nil
}

func quotedRequiredIdentifier(value string, field string) (string, error) {
	identifier, err := requiredIdentifier(value, field)
	if err != nil {
		return "", err
	}
	return quoteIdentifier(identifier), nil
}

func quoteIdentifier(value string) string {
	return strconv.Quote(strings.ReplaceAll(value, `"`, `""`))
}
