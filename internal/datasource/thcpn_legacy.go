package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"thcpn-gin/internal/apperr"
)

const (
	defaultTHCPNTableIndexField = "device_data_index"
	defaultTHCPNTableNameField  = "tb_name"
	defaultTHCPNIndexStartField = "start_at"
	defaultTHCPNIndexEndField   = "end_at"
	defaultTHCPNDeviceIDField   = "device_id"
	defaultTHCPNDataField       = "data"
	defaultTHCPNTimeField       = "ts"
	defaultTHCPNTypeField       = "type"
	defaultTHCPNDeletedAtField  = "deleted_at"
	defaultTHCPNIDField         = "id"
	defaultTHCPNMaxShardTables  = 8
)

const thcpnMonthlyShardTablePrefix = "device_data_"

var (
	thcpnShardTablePattern       = regexp.MustCompile(`^device_data_[0-9]+$`)
	thcpnMonthlyShardCutoverDate = time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
)

type thcpnLegacyBindingConfig struct {
	ExternalDeviceID int64  `json:"external_device_id"`
	LegacyDeviceID   int64  `json:"legacy_device_id"`
	RowType          string `json:"row_type"`
	JSONKey          string `json:"json_key"`
	ImageKey         string `json:"image_key"`
	ValuePath        string `json:"value_path"`
	ObjectKeyPath    string `json:"object_key_path"`
	MediaType        string `json:"media_type"`

	TableIndex      string `json:"table_index"`
	TableNameField  string `json:"table_name_field"`
	IndexStartField string `json:"index_start_field"`
	IndexEndField   string `json:"index_end_field"`
	DeviceIDField   string `json:"device_id_field"`
	DataField       string `json:"data_field"`
	TimeField       string `json:"time_field"`
	TypeField       string `json:"type_field"`
	DeletedAtField  string `json:"deleted_at_field"`
	IDField         string `json:"id_field"`
	MaxShardTables  int    `json:"max_shard_tables"`
}

type thcpnShardTable struct {
	Name string
}

type thcpnTelemetryShardResult struct {
	Points      []TelemetryPoint
	SkippedRows int
}

type thcpnTelemetryBucket struct {
	Min TelemetryPoint
	Max TelemetryPoint
	Set bool
}

type thcpnAdaptiveTelemetryCollector struct {
	start       time.Time
	end         time.Time
	rawLimit    int
	rawPoints   []TelemetryPoint
	buckets     []thcpnTelemetryBucket
	sourceCount int
	firstPoint  *TelemetryPoint
	lastPoint   *TelemetryPoint
}

func (r *Runtime) queryThcpnLegacyMySQLTelemetry(ctx context.Context, source DataSource, req TelemetryQuery) (TelemetryResult, error) {
	if source.Type != "mysql" {
		return TelemetryResult{}, apperr.New(apperr.KindDataSource, "thcpn_legacy_mysql adapter requires mysql data source type")
	}
	if err := validateTelemetryQuery(req); err != nil {
		return TelemetryResult{}, err
	}
	cfg, err := parseTHCPNLegacyTelemetryConfig(req.Binding.AdapterConfigJSON)
	if err != nil {
		return TelemetryResult{}, err
	}
	db, err := r.openMySQL(ctx, source)
	if err != nil {
		return TelemetryResult{}, err
	}
	defer db.Close()

	shards, err := queryTHCPNShardTables(ctx, db, cfg, req.Start, req.End)
	if err != nil {
		return TelemetryResult{}, err
	}
	if req.Adaptive {
		return queryTHCPNAdaptiveTelemetry(ctx, db, shards, cfg, req)
	}
	points := make([]TelemetryPoint, 0, req.Limit)
	skippedRows := 0
	for _, shard := range shards {
		shardResult, err := queryTHCPNShardTelemetry(ctx, db, shard.Name, cfg, req.Start, req.End, req.Limit)
		if err != nil {
			return TelemetryResult{}, err
		}
		points = append(points, shardResult.Points...)
		skippedRows += shardResult.SkippedRows
	}
	sort.SliceStable(points, func(i, j int) bool {
		return points[i].Timestamp.Before(points[j].Timestamp)
	})
	if len(points) > req.Limit {
		points = points[:req.Limit]
	}
	result := TelemetryResult{
		Points:      points,
		SourceCount: len(points),
		Complete:    len(points) < req.Limit,
	}
	if skippedRows > 0 {
		result.Warnings = append(result.Warnings, QueryWarning{
			Code:    "thcpn_config_mismatch",
			Message: fmt.Sprintf("部分历史数据与当前设备配置不匹配，已跳过 %d 条记录", skippedRows),
			Count:   skippedRows,
		})
	}
	return result, nil
}

func queryTHCPNAdaptiveTelemetry(ctx context.Context, db *sql.DB, shards []thcpnShardTable, cfg thcpnLegacyBindingConfig, req TelemetryQuery) (TelemetryResult, error) {
	collector := newTHCPNAdaptiveTelemetryCollector(req.Start, req.End, req.Limit, req.TargetPoints)
	skippedRows := 0
	for _, shard := range shards {
		skipped, err := scanTHCPNShardTelemetry(ctx, db, shard.Name, cfg, req.Start, req.End, collector.Add)
		if err != nil {
			return TelemetryResult{}, err
		}
		skippedRows += skipped
	}
	points, sampled := collector.Result()
	result := TelemetryResult{
		Points:      points,
		SourceCount: collector.sourceCount,
		Sampled:     sampled,
		Complete:    true,
	}
	if skippedRows > 0 {
		result.Warnings = append(result.Warnings, QueryWarning{
			Code:    "thcpn_config_mismatch",
			Message: fmt.Sprintf("部分历史数据与当前设备配置不匹配，已跳过 %d 条记录", skippedRows),
			Count:   skippedRows,
		})
	}
	return result, nil
}

func newTHCPNAdaptiveTelemetryCollector(start time.Time, end time.Time, rawLimit int, targetPoints int) *thcpnAdaptiveTelemetryCollector {
	if rawLimit <= 0 {
		rawLimit = 1
	}
	if targetPoints < 2 {
		targetPoints = 2
	}
	bucketCount := targetPoints / 2
	return &thcpnAdaptiveTelemetryCollector{
		start:     start,
		end:       end,
		rawLimit:  rawLimit,
		rawPoints: make([]TelemetryPoint, 0, rawLimit),
		buckets:   make([]thcpnTelemetryBucket, bucketCount),
	}
}

func (c *thcpnAdaptiveTelemetryCollector) Add(point TelemetryPoint) {
	c.sourceCount++
	if c.firstPoint == nil {
		first := point
		c.firstPoint = &first
	}
	last := point
	c.lastPoint = &last
	if c.sourceCount <= c.rawLimit {
		c.rawPoints = append(c.rawPoints, point)
	} else if c.rawPoints != nil {
		c.rawPoints = nil
	}

	bucketIndex := 0
	duration := c.end.Sub(c.start)
	if duration > 0 && len(c.buckets) > 1 {
		position := float64(point.Timestamp.Sub(c.start)) / float64(duration)
		bucketIndex = int(position * float64(len(c.buckets)))
		if bucketIndex < 0 {
			bucketIndex = 0
		}
		if bucketIndex >= len(c.buckets) {
			bucketIndex = len(c.buckets) - 1
		}
	}
	bucket := &c.buckets[bucketIndex]
	if !bucket.Set {
		bucket.Min = point
		bucket.Max = point
		bucket.Set = true
		return
	}
	if point.Value < bucket.Min.Value {
		bucket.Min = point
	}
	if point.Value > bucket.Max.Value {
		bucket.Max = point
	}
}

func (c *thcpnAdaptiveTelemetryCollector) Result() ([]TelemetryPoint, bool) {
	if c.sourceCount <= c.rawLimit {
		sort.SliceStable(c.rawPoints, func(i, j int) bool {
			return c.rawPoints[i].Timestamp.Before(c.rawPoints[j].Timestamp)
		})
		return c.rawPoints, false
	}
	points := make([]TelemetryPoint, 0, len(c.buckets)*2)
	if c.firstPoint != nil {
		points = append(points, *c.firstPoint)
	}
	for _, bucket := range c.buckets {
		if !bucket.Set {
			continue
		}
		points = append(points, bucket.Min)
		if bucket.Max.Timestamp != bucket.Min.Timestamp || bucket.Max.Value != bucket.Min.Value {
			points = append(points, bucket.Max)
		}
	}
	if c.lastPoint != nil {
		points = append(points, *c.lastPoint)
	}
	sort.SliceStable(points, func(i, j int) bool {
		return points[i].Timestamp.Before(points[j].Timestamp)
	})
	deduped := points[:0]
	for _, point := range points {
		if len(deduped) > 0 {
			previous := deduped[len(deduped)-1]
			if previous.Timestamp.Equal(point.Timestamp) && previous.Value == point.Value {
				continue
			}
		}
		deduped = append(deduped, point)
	}
	return deduped, true
}

func (r *Runtime) queryThcpnLegacyMySQLMedia(ctx context.Context, source DataSource, req MediaQuery) (MediaResult, error) {
	if source.Type != "mysql" {
		return MediaResult{}, apperr.New(apperr.KindDataSource, "thcpn_legacy_mysql adapter requires mysql data source type")
	}
	if err := validateMediaQuery(req); err != nil {
		return MediaResult{}, err
	}
	cfg, err := parseTHCPNLegacyMediaConfig(req.Binding.AdapterConfigJSON)
	if err != nil {
		return MediaResult{}, err
	}
	db, err := r.openMySQL(ctx, source)
	if err != nil {
		return MediaResult{}, err
	}
	defer db.Close()

	shards, err := queryTHCPNShardTables(ctx, db, cfg, req.Start, req.End)
	if err != nil {
		return MediaResult{}, err
	}

	total := 0
	items := make([]MediaRecord, 0)
	fetchLimit := req.Page * req.PageSize
	for _, shard := range shards {
		count, err := countTHCPNShardMedia(ctx, db, shard.Name, cfg, req.Start, req.End)
		if err != nil {
			return MediaResult{}, err
		}
		total += count
		shardItems, err := queryTHCPNShardMedia(ctx, db, shard.Name, cfg, req.Start, req.End, fetchLimit)
		if err != nil {
			return MediaResult{}, err
		}
		items = append(items, shardItems...)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CapturedAt.After(items[j].CapturedAt)
	})

	offset := (req.Page - 1) * req.PageSize
	if offset >= len(items) {
		items = []MediaRecord{}
	} else {
		end := offset + req.PageSize
		if end > len(items) {
			end = len(items)
		}
		items = items[offset:end]
	}
	return MediaResult{Items: items, Total: total}, nil
}

func parseTHCPNLegacyTelemetryConfig(raw json.RawMessage) (thcpnLegacyBindingConfig, error) {
	cfg, err := parseTHCPNLegacyConfig(raw)
	if err != nil {
		return thcpnLegacyBindingConfig{}, err
	}
	if cfg.RowType == "" {
		cfg.RowType = "data"
	}
	if cfg.RowType != "data" {
		return thcpnLegacyBindingConfig{}, apperr.New(apperr.KindInvalidArgument, "thcpn telemetry row_type must be data")
	}
	if cfg.JSONKey == "" {
		return thcpnLegacyBindingConfig{}, apperr.New(apperr.KindInvalidArgument, "adapter_config.json_key is required")
	}
	if cfg.ValuePath == "" {
		cfg.ValuePath = thcpnJSONValuePath(cfg.JSONKey)
	}
	return cfg, nil
}

func parseTHCPNLegacyMediaConfig(raw json.RawMessage) (thcpnLegacyBindingConfig, error) {
	cfg, err := parseTHCPNLegacyConfig(raw)
	if err != nil {
		return thcpnLegacyBindingConfig{}, err
	}
	if cfg.RowType == "" {
		cfg.RowType = "image"
	}
	if cfg.RowType != "image" {
		return thcpnLegacyBindingConfig{}, apperr.New(apperr.KindInvalidArgument, "thcpn media row_type must be image")
	}
	if cfg.ImageKey == "" {
		cfg.ImageKey = cfg.JSONKey
	}
	if cfg.ImageKey == "" {
		return thcpnLegacyBindingConfig{}, apperr.New(apperr.KindInvalidArgument, "adapter_config.image_key is required")
	}
	if cfg.ObjectKeyPath == "" {
		cfg.ObjectKeyPath = thcpnJSONValuePath(cfg.ImageKey)
	}
	if cfg.MediaType == "" {
		cfg.MediaType = "image"
	}
	return cfg, nil
}

func parseTHCPNLegacyConfig(raw json.RawMessage) (thcpnLegacyBindingConfig, error) {
	if len(raw) == 0 {
		return thcpnLegacyBindingConfig{}, apperr.New(apperr.KindInvalidArgument, "adapter_config is required")
	}
	var cfg thcpnLegacyBindingConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return thcpnLegacyBindingConfig{}, apperr.New(apperr.KindInvalidArgument, "invalid thcpn adapter_config")
	}
	if cfg.ExternalDeviceID == 0 && cfg.LegacyDeviceID > 0 {
		cfg.ExternalDeviceID = cfg.LegacyDeviceID
	}
	if cfg.ExternalDeviceID <= 0 {
		return thcpnLegacyBindingConfig{}, apperr.New(apperr.KindInvalidArgument, "adapter_config.external_device_id is required")
	}
	cfg.RowType = strings.TrimSpace(cfg.RowType)
	cfg.JSONKey = strings.TrimSpace(cfg.JSONKey)
	cfg.ImageKey = strings.TrimSpace(cfg.ImageKey)
	cfg.ValuePath = strings.TrimSpace(cfg.ValuePath)
	cfg.ObjectKeyPath = strings.TrimSpace(cfg.ObjectKeyPath)
	cfg.MediaType = strings.TrimSpace(cfg.MediaType)

	cfg.TableIndex = defaultIdentifier(cfg.TableIndex, defaultTHCPNTableIndexField)
	cfg.TableNameField = defaultIdentifier(cfg.TableNameField, defaultTHCPNTableNameField)
	cfg.IndexStartField = defaultIdentifier(cfg.IndexStartField, defaultTHCPNIndexStartField)
	cfg.IndexEndField = defaultIdentifier(cfg.IndexEndField, defaultTHCPNIndexEndField)
	cfg.DeviceIDField = defaultIdentifier(cfg.DeviceIDField, defaultTHCPNDeviceIDField)
	cfg.DataField = defaultIdentifier(cfg.DataField, defaultTHCPNDataField)
	cfg.TimeField = defaultIdentifier(cfg.TimeField, defaultTHCPNTimeField)
	cfg.TypeField = defaultIdentifier(cfg.TypeField, defaultTHCPNTypeField)
	cfg.DeletedAtField = defaultIdentifier(cfg.DeletedAtField, defaultTHCPNDeletedAtField)
	cfg.IDField = defaultIdentifier(cfg.IDField, defaultTHCPNIDField)
	if cfg.MaxShardTables <= 0 {
		cfg.MaxShardTables = defaultTHCPNMaxShardTables
	}
	if err := validateTHCPNConfigIdentifiers(cfg); err != nil {
		return thcpnLegacyBindingConfig{}, err
	}
	return cfg, nil
}

func validateTHCPNConfigIdentifiers(cfg thcpnLegacyBindingConfig) error {
	fields := map[string]string{
		"adapter_config.table_index":       cfg.TableIndex,
		"adapter_config.table_name_field":  cfg.TableNameField,
		"adapter_config.index_start_field": cfg.IndexStartField,
		"adapter_config.index_end_field":   cfg.IndexEndField,
		"adapter_config.device_id_field":   cfg.DeviceIDField,
		"adapter_config.data_field":        cfg.DataField,
		"adapter_config.time_field":        cfg.TimeField,
		"adapter_config.type_field":        cfg.TypeField,
		"adapter_config.deleted_at_field":  cfg.DeletedAtField,
		"adapter_config.id_field":          cfg.IDField,
	}
	for field, value := range fields {
		if _, err := requiredIdentifier(value, field); err != nil {
			return err
		}
	}
	return nil
}

func queryTHCPNShardTables(ctx context.Context, db *sql.DB, cfg thcpnLegacyBindingConfig, start time.Time, end time.Time) ([]thcpnShardTable, error) {
	if useMonthlyTHCPNShards(start) {
		return monthlyTHCPNShardTables(start, end, cfg.MaxShardTables)
	}

	query := fmt.Sprintf(
		"SELECT %s FROM %s WHERE %s <= ? AND %s >= ? ORDER BY %s ASC",
		quoteMySQLIdentifier(cfg.TableNameField),
		quoteMySQLIdentifier(cfg.TableIndex),
		quoteMySQLIdentifier(cfg.IndexStartField),
		quoteMySQLIdentifier(cfg.IndexEndField),
		quoteMySQLIdentifier(cfg.IndexStartField),
	)
	rows, err := db.QueryContext(ctx, query, end, start)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "query thcpn shard index", err)
	}
	defer rows.Close()

	shards := make([]thcpnShardTable, 0)
	seen := map[string]struct{}{}
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan thcpn shard index", err)
		}
		tableName = strings.TrimSpace(tableName)
		if err := validateTHCPNShardTableName(tableName); err != nil {
			return nil, err
		}
		if _, ok := seen[tableName]; ok {
			continue
		}
		seen[tableName] = struct{}{}
		shards = append(shards, thcpnShardTable{Name: tableName})
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn shard index", err)
	}
	if len(shards) > cfg.MaxShardTables {
		return nil, apperr.New(apperr.KindDataSource, "thcpn query touches too many shard tables")
	}
	return shards, nil
}

func useMonthlyTHCPNShards(start time.Time) bool {
	year, month, day := start.Date()
	cutoverYear, cutoverMonth, cutoverDay := thcpnMonthlyShardCutoverDate.Date()
	if year != cutoverYear {
		return year > cutoverYear
	}
	if month != cutoverMonth {
		return month > cutoverMonth
	}
	return day >= cutoverDay
}

func monthlyTHCPNShardTables(start time.Time, end time.Time, maxShardTables int) ([]thcpnShardTable, error) {
	if end.Before(start) {
		return nil, apperr.New(apperr.KindInvalidArgument, "thcpn shard query end must not be before start")
	}
	if maxShardTables <= 0 {
		maxShardTables = defaultTHCPNMaxShardTables
	}

	end = end.In(start.Location())
	month := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, start.Location())
	lastMonth := time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, start.Location())
	shards := make([]thcpnShardTable, 0)
	for !month.After(lastMonth) {
		if len(shards) >= maxShardTables {
			return nil, apperr.New(apperr.KindDataSource, "thcpn query touches too many shard tables")
		}
		tableName := fmt.Sprintf("%s%04d%02d", thcpnMonthlyShardTablePrefix, month.Year(), month.Month())
		if err := validateTHCPNShardTableName(tableName); err != nil {
			return nil, err
		}
		shards = append(shards, thcpnShardTable{Name: tableName})
		month = month.AddDate(0, 1, 0)
	}
	return shards, nil
}

func queryTHCPNShardTelemetry(ctx context.Context, db *sql.DB, tableName string, cfg thcpnLegacyBindingConfig, start time.Time, end time.Time, limit int) (thcpnTelemetryShardResult, error) {
	query := fmt.Sprintf(
		"SELECT %s, JSON_UNQUOTE(JSON_EXTRACT(%s, ?)) FROM %s WHERE %s = ? AND %s IS NULL AND %s = ? AND %s >= ? AND %s <= ? ORDER BY %s ASC LIMIT ?",
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.DataField),
		quoteMySQLIdentifier(tableName),
		quoteMySQLIdentifier(cfg.DeviceIDField),
		quoteMySQLIdentifier(cfg.DeletedAtField),
		quoteMySQLIdentifier(cfg.TypeField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.TimeField),
	)
	rows, err := db.QueryContext(ctx, query, cfg.ValuePath, cfg.ExternalDeviceID, cfg.RowType, start, end, limit)
	if err != nil {
		return thcpnTelemetryShardResult{}, apperr.Wrap(apperr.KindDataSource, "query thcpn telemetry shard", err)
	}
	defer rows.Close()

	points := make([]TelemetryPoint, 0)
	skippedRows := 0
	for rows.Next() {
		var point TelemetryPoint
		var rawValue sql.NullString
		if err := rows.Scan(&point.Timestamp, &rawValue); err != nil {
			return thcpnTelemetryShardResult{}, apperr.Wrap(apperr.KindDataSource, "scan thcpn telemetry point", err)
		}
		value, ok := parseTHCPNTelemetryValue(rawValue)
		if !ok {
			skippedRows++
			continue
		}
		point.Value = value
		point.Quality = "valid"
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return thcpnTelemetryShardResult{}, apperr.Wrap(apperr.KindDataSource, "read thcpn telemetry points", err)
	}
	return thcpnTelemetryShardResult{Points: points, SkippedRows: skippedRows}, nil
}

func scanTHCPNShardTelemetry(ctx context.Context, db *sql.DB, tableName string, cfg thcpnLegacyBindingConfig, start time.Time, end time.Time, add func(TelemetryPoint)) (int, error) {
	query := fmt.Sprintf(
		"SELECT %s, JSON_UNQUOTE(JSON_EXTRACT(%s, ?)) FROM %s WHERE %s = ? AND %s IS NULL AND %s = ? AND %s >= ? AND %s <= ? ORDER BY %s ASC",
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.DataField),
		quoteMySQLIdentifier(tableName),
		quoteMySQLIdentifier(cfg.DeviceIDField),
		quoteMySQLIdentifier(cfg.DeletedAtField),
		quoteMySQLIdentifier(cfg.TypeField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.TimeField),
	)
	rows, err := db.QueryContext(ctx, query, cfg.ValuePath, cfg.ExternalDeviceID, cfg.RowType, start, end)
	if err != nil {
		return 0, apperr.Wrap(apperr.KindDataSource, "query thcpn telemetry shard", err)
	}
	defer rows.Close()

	skippedRows := 0
	for rows.Next() {
		var point TelemetryPoint
		var rawValue sql.NullString
		if err := rows.Scan(&point.Timestamp, &rawValue); err != nil {
			return 0, apperr.Wrap(apperr.KindDataSource, "scan thcpn telemetry point", err)
		}
		value, ok := parseTHCPNTelemetryValue(rawValue)
		if !ok {
			skippedRows++
			continue
		}
		point.Value = value
		point.Quality = "valid"
		add(point)
	}
	if err := rows.Err(); err != nil {
		return 0, apperr.Wrap(apperr.KindDataSource, "read thcpn telemetry points", err)
	}
	return skippedRows, nil
}

func parseTHCPNTelemetryValue(raw sql.NullString) (float64, bool) {
	if !raw.Valid {
		return 0, false
	}
	value := strings.TrimSpace(raw.String)
	if value == "" || strings.EqualFold(value, "null") {
		return 0, false
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0, false
	}
	return parsed, true
}

func countTHCPNShardMedia(ctx context.Context, db *sql.DB, tableName string, cfg thcpnLegacyBindingConfig, start time.Time, end time.Time) (int, error) {
	query := fmt.Sprintf(
		"SELECT COUNT(*) FROM %s WHERE %s = ? AND %s IS NULL AND %s = ? AND %s >= ? AND %s <= ? AND JSON_EXTRACT(%s, ?) IS NOT NULL",
		quoteMySQLIdentifier(tableName),
		quoteMySQLIdentifier(cfg.DeviceIDField),
		quoteMySQLIdentifier(cfg.DeletedAtField),
		quoteMySQLIdentifier(cfg.TypeField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.DataField),
	)
	var count int
	if err := db.QueryRowContext(ctx, query, cfg.ExternalDeviceID, cfg.RowType, start, end, cfg.ObjectKeyPath).Scan(&count); err != nil {
		return 0, apperr.Wrap(apperr.KindDataSource, "count thcpn media shard", err)
	}
	return count, nil
}

func queryTHCPNShardMedia(ctx context.Context, db *sql.DB, tableName string, cfg thcpnLegacyBindingConfig, start time.Time, end time.Time, limit int) ([]MediaRecord, error) {
	query := fmt.Sprintf(
		"SELECT CAST(%s AS CHAR), %s, JSON_UNQUOTE(JSON_EXTRACT(%s, ?)) FROM %s WHERE %s = ? AND %s IS NULL AND %s = ? AND %s >= ? AND %s <= ? AND JSON_EXTRACT(%s, ?) IS NOT NULL ORDER BY %s DESC LIMIT ?",
		quoteMySQLIdentifier(cfg.IDField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.DataField),
		quoteMySQLIdentifier(tableName),
		quoteMySQLIdentifier(cfg.DeviceIDField),
		quoteMySQLIdentifier(cfg.DeletedAtField),
		quoteMySQLIdentifier(cfg.TypeField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.TimeField),
		quoteMySQLIdentifier(cfg.DataField),
		quoteMySQLIdentifier(cfg.TimeField),
	)
	rows, err := db.QueryContext(ctx, query, cfg.ObjectKeyPath, cfg.ExternalDeviceID, cfg.RowType, start, end, cfg.ObjectKeyPath, limit)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "query thcpn media shard", err)
	}
	defer rows.Close()

	items := make([]MediaRecord, 0)
	for rows.Next() {
		var item MediaRecord
		var rawID string
		var objectKey sql.NullString
		if err := rows.Scan(&rawID, &item.CapturedAt, &objectKey); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan thcpn media record", err)
		}
		if !objectKey.Valid || strings.TrimSpace(objectKey.String) == "" {
			continue
		}
		item.ID = tableName + ":" + rawID
		item.ObjectKey = strings.TrimSpace(objectKey.String)
		item.MediaType = cfg.MediaType
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn media records", err)
	}
	return items, nil
}

func validateTHCPNShardTableName(value string) error {
	if !thcpnShardTablePattern.MatchString(value) {
		return apperr.New(apperr.KindDataSource, "invalid thcpn shard table name")
	}
	return nil
}

func thcpnJSONValuePath(key string) string {
	encoded, err := json.Marshal(key)
	if err != nil {
		return "$." + key + ".value"
	}
	return "$." + string(encoded) + ".value"
}

func defaultIdentifier(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
