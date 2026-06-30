package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	mysql "github.com/go-sql-driver/mysql"
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

type sqlDialect struct {
	name        string
	quote       func(string) string
	placeholder func(int) string
	castFloat   func(string) string
	castText    func(string) string
	nullText    string
}

var postgresDialect = sqlDialect{
	name:        "postgres",
	quote:       quoteIdentifier,
	placeholder: func(index int) string { return "$" + strconv.Itoa(index) },
	castFloat:   func(expr string) string { return expr + "::double precision" },
	castText:    func(expr string) string { return expr + "::text" },
	nullText:    "NULL::text",
}

var mysqlDialect = sqlDialect{
	name:        "mysql",
	quote:       quoteMySQLIdentifier,
	placeholder: func(int) string { return "?" },
	castFloat:   func(expr string) string { return "CAST(" + expr + " AS DOUBLE)" },
	castText:    func(expr string) string { return "CAST(" + expr + " AS CHAR)" },
	nullText:    "CAST(NULL AS CHAR)",
}

type queryPlan struct {
	Query string
	Args  []any
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
	case "mysql":
		return r.queryMySQLTelemetry(ctx, source, req)
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
	case "mysql":
		return r.queryMySQLMedia(ctx, source, req)
	default:
		return MediaResult{}, apperr.New(apperr.KindDataSource, "unsupported media data source type")
	}
}

func (r *Runtime) queryPostgresTelemetry(ctx context.Context, source DataSource, req TelemetryQuery) (TelemetryResult, error) {
	if err := validateTelemetryQuery(req); err != nil {
		return TelemetryResult{}, err
	}
	dsn, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return TelemetryResult{}, err
	}

	plan, err := buildTelemetryQueryPlan(req, postgresDialect)
	if err != nil {
		return TelemetryResult{}, err
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return TelemetryResult{}, apperr.Wrap(apperr.KindDataSource, "connect data source", err)
	}
	defer pool.Close()

	rows, err := pool.Query(ctx, plan.Query, plan.Args...)
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

func (r *Runtime) queryMySQLTelemetry(ctx context.Context, source DataSource, req TelemetryQuery) (TelemetryResult, error) {
	if err := validateTelemetryQuery(req); err != nil {
		return TelemetryResult{}, err
	}
	plan, err := buildTelemetryQueryPlan(req, mysqlDialect)
	if err != nil {
		return TelemetryResult{}, err
	}
	db, err := r.openMySQL(ctx, source)
	if err != nil {
		return TelemetryResult{}, err
	}
	defer db.Close()

	rows, err := db.QueryContext(ctx, plan.Query, plan.Args...)
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
	if err := validateMediaQuery(req); err != nil {
		return MediaResult{}, err
	}
	cfg, err := parseMediaBindingConfig(req.Binding.QueryConfigJSON)
	if err != nil {
		return MediaResult{}, err
	}
	dsn, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return MediaResult{}, err
	}
	countPlan, err := buildMediaCountQueryPlan(req, postgresDialect)
	if err != nil {
		return MediaResult{}, err
	}
	rowsPlan, err := buildMediaRowsQueryPlan(req, cfg, postgresDialect)
	if err != nil {
		return MediaResult{}, err
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return MediaResult{}, apperr.Wrap(apperr.KindDataSource, "connect data source", err)
	}
	defer pool.Close()

	var total int
	if err := pool.QueryRow(ctx, countPlan.Query, countPlan.Args...).Scan(&total); err != nil {
		return MediaResult{}, apperr.Wrap(apperr.KindDataSource, "count media data source", err)
	}

	rows, err := pool.Query(ctx, rowsPlan.Query, rowsPlan.Args...)
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

func (r *Runtime) queryMySQLMedia(ctx context.Context, source DataSource, req MediaQuery) (MediaResult, error) {
	if err := validateMediaQuery(req); err != nil {
		return MediaResult{}, err
	}
	cfg, err := parseMediaBindingConfig(req.Binding.QueryConfigJSON)
	if err != nil {
		return MediaResult{}, err
	}
	countPlan, err := buildMediaCountQueryPlan(req, mysqlDialect)
	if err != nil {
		return MediaResult{}, err
	}
	rowsPlan, err := buildMediaRowsQueryPlan(req, cfg, mysqlDialect)
	if err != nil {
		return MediaResult{}, err
	}

	db, err := r.openMySQL(ctx, source)
	if err != nil {
		return MediaResult{}, err
	}
	defer db.Close()

	var total int
	if err := db.QueryRowContext(ctx, countPlan.Query, countPlan.Args...).Scan(&total); err != nil {
		return MediaResult{}, apperr.Wrap(apperr.KindDataSource, "count media data source", err)
	}

	rows, err := db.QueryContext(ctx, rowsPlan.Query, rowsPlan.Args...)
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

func validateTelemetryQuery(req TelemetryQuery) error {
	if req.Binding.PayloadType != "columns" {
		return apperr.New(apperr.KindDataSource, "unsupported telemetry payload type")
	}
	if req.Limit <= 0 {
		return apperr.New(apperr.KindInvalidArgument, "limit must be greater than 0")
	}
	return nil
}

func validateMediaQuery(req MediaQuery) error {
	if req.Binding.PayloadType != "media" {
		return apperr.New(apperr.KindDataSource, "unsupported media payload type")
	}
	if req.Page <= 0 {
		return apperr.New(apperr.KindInvalidArgument, "page must be greater than 0")
	}
	if req.PageSize <= 0 {
		return apperr.New(apperr.KindInvalidArgument, "page_size must be greater than 0")
	}
	return nil
}

func buildTelemetryQueryPlan(req TelemetryQuery, dialect sqlDialect) (queryPlan, error) {
	tableName, err := quotedTableNameFor(req.Binding, dialect)
	if err != nil {
		return queryPlan{}, err
	}
	timeField, err := quotedRequiredIdentifierFor(req.Binding.TimeField, "time_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}
	valueField, err := quotedRequiredIdentifierFor(req.Binding.ValueField, "value_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}
	deviceKeyField, err := quotedRequiredIdentifierFor(req.Binding.DeviceKeyField, "device_key_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}

	query := fmt.Sprintf(
		`SELECT %s, %s FROM %s WHERE %s = %s AND %s >= %s AND %s <= %s ORDER BY %s ASC LIMIT %s`,
		timeField,
		dialect.castFloat(valueField),
		tableName,
		deviceKeyField,
		dialect.placeholder(1),
		timeField,
		dialect.placeholder(2),
		timeField,
		dialect.placeholder(3),
		timeField,
		dialect.placeholder(4),
	)
	return queryPlan{
		Query: query,
		Args:  []any{req.Binding.DeviceKeyValue, req.Start, req.End, req.Limit},
	}, nil
}

func buildMediaCountQueryPlan(req MediaQuery, dialect sqlDialect) (queryPlan, error) {
	tableName, err := quotedTableNameFor(req.Binding, dialect)
	if err != nil {
		return queryPlan{}, err
	}
	timeField, err := quotedRequiredIdentifierFor(req.Binding.TimeField, "time_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}
	deviceKeyField, err := quotedRequiredIdentifierFor(req.Binding.DeviceKeyField, "device_key_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}

	query := fmt.Sprintf(
		`SELECT count(*) FROM %s WHERE %s = %s AND %s >= %s AND %s <= %s`,
		tableName,
		deviceKeyField,
		dialect.placeholder(1),
		timeField,
		dialect.placeholder(2),
		timeField,
		dialect.placeholder(3),
	)
	return queryPlan{
		Query: query,
		Args:  []any{req.Binding.DeviceKeyValue, req.Start, req.End},
	}, nil
}

func buildMediaRowsQueryPlan(req MediaQuery, cfg mediaBindingConfig, dialect sqlDialect) (queryPlan, error) {
	tableName, err := quotedTableNameFor(req.Binding, dialect)
	if err != nil {
		return queryPlan{}, err
	}
	timeField, err := quotedRequiredIdentifierFor(req.Binding.TimeField, "time_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}
	deviceKeyField, err := quotedRequiredIdentifierFor(req.Binding.DeviceKeyField, "device_key_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}
	objectKeyFieldName := strings.TrimSpace(cfg.ObjectKeyField)
	if objectKeyFieldName == "" {
		objectKeyFieldName = req.Binding.ValueField
	}
	objectKeyField, err := quotedRequiredIdentifierFor(objectKeyFieldName, "object_key_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}
	idFieldName := strings.TrimSpace(cfg.IDField)
	if idFieldName == "" {
		idFieldName = objectKeyFieldName
	}
	idField, err := quotedRequiredIdentifierFor(idFieldName, "id_field", dialect)
	if err != nil {
		return queryPlan{}, err
	}
	thumbnailField := dialect.nullText
	if strings.TrimSpace(cfg.ThumbnailKeyField) != "" {
		thumbnailField, err = quotedRequiredIdentifierFor(cfg.ThumbnailKeyField, "thumbnail_key_field", dialect)
		if err != nil {
			return queryPlan{}, err
		}
		thumbnailField = dialect.castText(thumbnailField)
	}

	args := make([]any, 0, 6)
	mediaTypeExpr := ""
	if strings.TrimSpace(cfg.MediaTypeField) != "" {
		mediaTypeExpr, err = quotedRequiredIdentifierFor(cfg.MediaTypeField, "media_type_field", dialect)
		if err != nil {
			return queryPlan{}, err
		}
		mediaTypeExpr = dialect.castText(mediaTypeExpr)
	} else {
		args = append(args, defaultMediaType(cfg, req.MediaType))
		mediaTypeExpr = dialect.castText(dialect.placeholder(len(args)))
	}

	offset := (req.Page - 1) * req.PageSize
	deviceKeyPlaceholder := dialect.placeholder(len(args) + 1)
	startPlaceholder := dialect.placeholder(len(args) + 2)
	endPlaceholder := dialect.placeholder(len(args) + 3)
	limitPlaceholder := dialect.placeholder(len(args) + 4)
	offsetPlaceholder := dialect.placeholder(len(args) + 5)
	args = append(args, req.Binding.DeviceKeyValue, req.Start, req.End, req.PageSize, offset)

	query := fmt.Sprintf(
		`SELECT %s, %s, %s, %s, %s FROM %s WHERE %s = %s AND %s >= %s AND %s <= %s ORDER BY %s DESC LIMIT %s OFFSET %s`,
		dialect.castText(idField),
		timeField,
		dialect.castText(objectKeyField),
		thumbnailField,
		mediaTypeExpr,
		tableName,
		deviceKeyField,
		deviceKeyPlaceholder,
		timeField,
		startPlaceholder,
		timeField,
		endPlaceholder,
		timeField,
		limitPlaceholder,
		offsetPlaceholder,
	)
	return queryPlan{Query: query, Args: args}, nil
}

func defaultMediaType(cfg mediaBindingConfig, requested string) string {
	value := strings.TrimSpace(cfg.MediaType)
	if value == "" {
		value = strings.TrimSpace(requested)
	}
	if value == "" {
		value = "media"
	}
	return value
}

func (r *Runtime) openMySQL(ctx context.Context, source DataSource) (*sql.DB, error) {
	dsn, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return nil, err
	}
	dsn, err = mysqlDSNWithParseTime(dsn)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "connect data source", err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, apperr.Wrap(apperr.KindDataSource, "connect data source", err)
	}
	return db, nil
}

func mysqlDSNWithParseTime(dsn string) (string, error) {
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return "", apperr.Wrap(apperr.KindDataSource, "parse mysql data source dsn", err)
	}
	cfg.ParseTime = true
	return cfg.FormatDSN(), nil
}

func quotedTableName(binding DataStreamBinding) (string, error) {
	return quotedTableNameFor(binding, postgresDialect)
}

func quotedTableNameFor(binding DataStreamBinding, dialect sqlDialect) (string, error) {
	tableName, err := quotedRequiredIdentifierFor(binding.TableName, "table_name", dialect)
	if err != nil {
		return "", err
	}
	qualifier := tableQualifier(binding, dialect)
	if qualifier == "" {
		return tableName, nil
	}
	quotedQualifier, err := quotedRequiredIdentifierFor(qualifier, tableQualifierField(dialect), dialect)
	if err != nil {
		return "", err
	}
	return quotedQualifier + "." + tableName, nil
}

func tableQualifier(binding DataStreamBinding, dialect sqlDialect) string {
	if dialect.name == "mysql" {
		if binding.DatabaseName != nil && strings.TrimSpace(*binding.DatabaseName) != "" {
			return strings.TrimSpace(*binding.DatabaseName)
		}
		if binding.SchemaName != nil && strings.TrimSpace(*binding.SchemaName) != "" {
			return strings.TrimSpace(*binding.SchemaName)
		}
		return ""
	}
	if binding.SchemaName == nil {
		return ""
	}
	return strings.TrimSpace(*binding.SchemaName)
}

func tableQualifierField(dialect sqlDialect) string {
	if dialect.name == "mysql" {
		return "database_name"
	}
	return "schema_name"
}

func quotedRequiredIdentifier(value string, field string) (string, error) {
	return quotedRequiredIdentifierFor(value, field, postgresDialect)
}

func quotedRequiredIdentifierFor(value string, field string, dialect sqlDialect) (string, error) {
	identifier, err := requiredIdentifier(value, field)
	if err != nil {
		return "", err
	}
	return dialect.quote(identifier), nil
}

func quoteIdentifier(value string) string {
	return strconv.Quote(strings.ReplaceAll(value, `"`, `""`))
}

func quoteMySQLIdentifier(value string) string {
	return "`" + strings.ReplaceAll(value, "`", "``") + "`"
}
