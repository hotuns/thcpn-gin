package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"thcpn-gin/internal/apperr"
)

const maxTHCPNSensorTemplatePageSize = 100

type THCPNSensorTemplateListInput struct {
	DeviceID     uuid.UUID
	Search       string
	Port         string
	Driver       string
	Status       string
	SourceFamily string
	Page         int
	PageSize     int
}

type THCPNSensorTemplateWriteInput struct {
	SensorType  string
	Description string
	Port        string
	PortNum     int64
	Driver      string
	PortNums    []int
	Params      map[string]any
	Metrics     []map[string]any
	Variants    map[string]map[string]any
	Status      string
	ActorID     uuid.UUID
}

type THCPNSensorTemplateImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
	Invalid  int `json:"invalid"`
}

type THCPNSensorMetric struct {
	Key    string         `json:"key"`
	Name   string         `json:"name,omitempty"`
	Type   string         `json:"type,omitempty"`
	Unit   string         `json:"unit,omitempty"`
	Index  any            `json:"index,omitempty"`
	Min    any            `json:"min,omitempty"`
	Max    any            `json:"max,omitempty"`
	Decode string         `json:"decode,omitempty"`
	Raw    map[string]any `json:"raw"`
}

type THCPNSensorTemplate struct {
	ID          int64                     `json:"id"`
	SensorType  string                    `json:"sensor_type"`
	Description string                    `json:"description,omitempty"`
	Port        string                    `json:"port,omitempty"`
	PortNum     int64                     `json:"port_num"`
	Driver      string                    `json:"driver,omitempty"`
	PortNums    []int                     `json:"port_nums"`
	Params      map[string]any            `json:"params"`
	Status      string                    `json:"status"`
	Metrics     []THCPNSensorMetric       `json:"metrics"`
	Variants    map[string]map[string]any `json:"variants"`
	ConfigEntry map[string]any            `json:"config_entry"`
	Valid       bool                      `json:"valid"`
	Warnings    []QueryWarning            `json:"warnings,omitempty"`
	CreatedAt   *time.Time                `json:"created_at,omitempty"`
	UpdatedAt   *time.Time                `json:"updated_at,omitempty"`
}

type THCPNSensorTemplateListResponse struct {
	Items    []THCPNSensorTemplate `json:"items"`
	Total    int                   `json:"total"`
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
}

func (s *Service) ListTHCPNSensorTemplates(ctx context.Context, input THCPNSensorTemplateListInput) (THCPNSensorTemplateListResponse, error) {
	if input.DeviceID != uuid.Nil || strings.TrimSpace(input.SourceFamily) == "" {
		input.SourceFamily = "thcpn"
	}
	var externalDeviceType *string
	if input.DeviceID != uuid.Nil {
		db, ref, err := s.openTHCPNDevice(ctx, input.DeviceID)
		if err == nil {
			if externalDevice, readErr := readTHCPNExternalDevice(ctx, db, ref.ExternalDeviceID); readErr == nil {
				externalDeviceType = externalDevice.DeviceType
			}
		}
	}

	page, pageSize := normalizeSensorTemplatePage(input.Page, input.PageSize)
	where, args := buildSensorTemplateWhere(input)
	var total int
	if err := s.db.QueryRow(ctx, "SELECT COUNT(*) FROM sensor_templates"+where, args...).Scan(&total); err != nil {
		return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "count sensor templates", err)
	}
	args = append(args, pageSize, (page-1)*pageSize)
	limitPosition := len(args) - 1
	rows, err := s.db.Query(ctx, `SELECT id, sensor_type, description, port, port_num, driver, port_nums, params, metrics, status, created_at, updated_at
FROM sensor_templates`+where+fmt.Sprintf(` ORDER BY sensor_type, id LIMIT $%d OFFSET $%d`, limitPosition, limitPosition+1), args...)
	if err != nil {
		return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "list sensor templates", err)
	}
	defer rows.Close()

	items := make([]THCPNSensorTemplate, 0, pageSize)
	for rows.Next() {
		item, scanErr := scanPlatformSensorTemplate(rows, externalDeviceType)
		if scanErr != nil {
			return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "scan sensor template", scanErr)
		}
		if scanErr = s.loadSensorTemplateVariants(ctx, &item); scanErr != nil {
			return THCPNSensorTemplateListResponse{}, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "read sensor templates", err)
	}
	return THCPNSensorTemplateListResponse{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) GetTHCPNSensorTemplate(ctx context.Context, id int64) (THCPNSensorTemplate, error) {
	item, err := scanPlatformSensorTemplate(s.db.QueryRow(ctx, `SELECT id, sensor_type, description, port, port_num, driver, port_nums, params, metrics, status, created_at, updated_at
FROM sensor_templates WHERE id = $1`, id), nil)
	if errors.Is(err, pgx.ErrNoRows) {
		return THCPNSensorTemplate{}, apperr.New(apperr.KindNotFound, "sensor template not found")
	}
	if err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "get sensor template", err)
	}
	if err := s.loadSensorTemplateVariants(ctx, &item); err != nil {
		return THCPNSensorTemplate{}, err
	}
	return item, nil
}

func (s *Service) CreateTHCPNSensorTemplate(ctx context.Context, input THCPNSensorTemplateWriteInput) (THCPNSensorTemplate, error) {
	if err := validateSensorTemplateWrite(input); err != nil {
		return THCPNSensorTemplate{}, err
	}
	portNums, _ := json.Marshal(input.PortNums)
	params, _ := json.Marshal(input.Params)
	metrics := input.Metrics
	if len(metrics) == 0 {
		metrics = metricMapsFromParams(input.Params)
	}
	metricsRaw, _ := json.Marshal(metrics)
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "begin sensor template create", err)
	}
	defer tx.Rollback(context.Background())
	var id int64
	err = tx.QueryRow(ctx, `INSERT INTO sensor_templates
(sensor_type, description, port, port_num, driver, port_nums, params, metrics, status, created_by, updated_by)
VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7, $8, $9, $10, $10)
RETURNING id`, strings.TrimSpace(input.SensorType), strings.TrimSpace(input.Description), strings.TrimSpace(input.Port),
		input.PortNum, strings.TrimSpace(input.Driver), string(portNums), string(params), string(metricsRaw), normalizeSensorTemplateStatus(input.Status), nullableUUID(input.ActorID)).Scan(&id)
	if err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "create sensor template", err)
	}
	if err := upsertSensorTemplateVariants(ctx, tx, id, input); err != nil {
		return THCPNSensorTemplate{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "commit sensor template create", err)
	}
	return s.GetTHCPNSensorTemplate(ctx, id)
}

func (s *Service) UpdateTHCPNSensorTemplate(ctx context.Context, id int64, input THCPNSensorTemplateWriteInput) (THCPNSensorTemplate, error) {
	if err := validateSensorTemplateWrite(input); err != nil {
		return THCPNSensorTemplate{}, err
	}
	portNums, _ := json.Marshal(input.PortNums)
	params, _ := json.Marshal(input.Params)
	metrics := input.Metrics
	if len(metrics) == 0 {
		metrics = metricMapsFromParams(input.Params)
	}
	metricsRaw, _ := json.Marshal(metrics)
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "begin sensor template update", err)
	}
	defer tx.Rollback(context.Background())
	var currentFamily string
	if err := tx.QueryRow(ctx, `SELECT source_family FROM sensor_template_variants WHERE template_id=$1 FOR UPDATE`, id).Scan(&currentFamily); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return THCPNSensorTemplate{}, apperr.New(apperr.KindNotFound, "sensor template not found")
		}
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "read sensor template version", err)
	}
	nextFamily := "thcpn"
	if _, ok := input.Variants["lorawan_v2"]; ok {
		nextFamily = "lorawan_v2"
	}
	if currentFamily != nextFamily {
		return THCPNSensorTemplate{}, apperr.New(apperr.KindInvalidArgument, "sensor template version cannot be changed")
	}
	tag, err := tx.Exec(ctx, `UPDATE sensor_templates SET
sensor_type = $2, description = NULLIF($3, ''), port = NULLIF($4, ''), port_num = $5,
driver = NULLIF($6, ''), port_nums = $7, params = $8, metrics = $9, status = $10,
updated_by = $11, updated_at = now()
WHERE id = $1`, id, strings.TrimSpace(input.SensorType), strings.TrimSpace(input.Description), strings.TrimSpace(input.Port),
		input.PortNum, strings.TrimSpace(input.Driver), string(portNums), string(params), string(metricsRaw), normalizeSensorTemplateStatus(input.Status), nullableUUID(input.ActorID))
	if err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "update sensor template", err)
	}
	if tag.RowsAffected() == 0 {
		return THCPNSensorTemplate{}, apperr.New(apperr.KindNotFound, "sensor template not found")
	}
	if err := upsertSensorTemplateVariants(ctx, tx, id, input); err != nil {
		return THCPNSensorTemplate{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "commit sensor template update", err)
	}
	return s.GetTHCPNSensorTemplate(ctx, id)
}

func (s *Service) DeleteTHCPNSensorTemplate(ctx context.Context, id int64) error {
	tag, err := s.db.Exec(ctx, "DELETE FROM sensor_templates WHERE id = $1", id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete sensor template", err)
	}
	if tag.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "sensor template not found")
	}
	return nil
}

func (s *Service) ImportTHCPNSensorTemplates(ctx context.Context, dataSourceID, actorID uuid.UUID) (THCPNSensorTemplateImportResult, error) {
	source, err := s.loadTHCPNSyncDataSource(ctx, dataSourceID)
	if err != nil {
		return THCPNSensorTemplateImportResult{}, err
	}
	sourceDB, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return THCPNSensorTemplateImportResult{}, err
	}
	rows, err := sourceDB.QueryContext(ctx, `SELECT sensor_type, description, port, port_num, sensor, port_nums, params
FROM sensors WHERE deleted_at IS NULL ORDER BY sensor_type, id`)
	if err != nil {
		return THCPNSensorTemplateImportResult{}, apperr.Wrap(apperr.KindDataSource, "list source sensor templates", err)
	}
	defer rows.Close()

	result := THCPNSensorTemplateImportResult{}
	for rows.Next() {
		var sensorType string
		var description, port, driver, portNumsRaw, paramsRaw sql.NullString
		var portNum sql.NullInt64
		if err := rows.Scan(&sensorType, &description, &port, &portNum, &driver, &portNumsRaw, &paramsRaw); err != nil {
			return result, apperr.Wrap(apperr.KindDataSource, "scan source sensor template", err)
		}
		portNums := []int{}
		params := map[string]any{}
		if (portNumsRaw.Valid && decodeFlexibleJSON(portNumsRaw.String, &portNums) != nil) ||
			(paramsRaw.Valid && decodeFlexibleJSON(paramsRaw.String, &params) != nil) {
			result.Invalid++
			continue
		}
		portNumsJSON, _ := json.Marshal(portNums)
		paramsJSON, _ := json.Marshal(params)
		metricsJSON, _ := json.Marshal(metricMapsFromParams(params))
		var insertedID int64
		insertErr := s.db.QueryRow(ctx, `INSERT INTO sensor_templates
(sensor_type, description, port, port_num, driver, port_nums, params, metrics, status, created_by, updated_by)
SELECT $1, NULLIF($2, ''), NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7, $8, 'active', $9, $9
WHERE NOT EXISTS (
  SELECT 1 FROM sensor_templates
  WHERE sensor_type = $1 AND port IS NOT DISTINCT FROM NULLIF($3, '')
    AND driver IS NOT DISTINCT FROM NULLIF($5, '') AND params = $7::jsonb
    AND EXISTS (SELECT 1 FROM sensor_template_variants v WHERE v.template_id=sensor_templates.id AND v.source_family='thcpn')
) RETURNING id`, strings.TrimSpace(sensorType), nullableString(description), nullableString(port), portNum.Int64,
			nullableString(driver), string(portNumsJSON), string(paramsJSON), string(metricsJSON), nullableUUID(actorID)).Scan(&insertedID)
		if insertErr != nil && !errors.Is(insertErr, pgx.ErrNoRows) {
			return result, apperr.Wrap(apperr.KindInternal, "import sensor template", insertErr)
		}
		if errors.Is(insertErr, pgx.ErrNoRows) {
			result.Skipped++
		} else {
			input := THCPNSensorTemplateWriteInput{Port: nullableString(port), PortNum: portNum.Int64, Driver: nullableString(driver), PortNums: portNums, Params: params}
			if err := upsertSensorTemplateVariants(ctx, s.db, insertedID, input); err != nil {
				return result, err
			}
			result.Imported++
		}
	}
	if err := rows.Err(); err != nil {
		return result, apperr.Wrap(apperr.KindDataSource, "read source sensor templates", err)
	}
	return result, nil
}

func normalizeSensorTemplatePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > maxTHCPNSensorTemplatePageSize {
		pageSize = maxTHCPNSensorTemplatePageSize
	}
	return page, pageSize
}

func buildSensorTemplateWhere(input THCPNSensorTemplateListInput) (string, []any) {
	clauses := make([]string, 0, 4)
	args := make([]any, 0, 6)
	add := func(expression string, values ...any) {
		clauses = append(clauses, expression)
		args = append(args, values...)
	}
	if search := strings.TrimSpace(input.Search); search != "" {
		position := len(args) + 1
		add(fmt.Sprintf("(sensor_type ILIKE $%d OR COALESCE(description, '') ILIKE $%d OR COALESCE(driver, '') ILIKE $%d)", position, position+1, position+2),
			"%"+search+"%", "%"+search+"%", "%"+search+"%")
	}
	if port := strings.TrimSpace(input.Port); port != "" {
		add(fmt.Sprintf("port = $%d", len(args)+1), port)
	}
	if driver := strings.TrimSpace(input.Driver); driver != "" {
		add(fmt.Sprintf("driver = $%d", len(args)+1), driver)
	}
	if status := strings.TrimSpace(input.Status); status != "" {
		add(fmt.Sprintf("status = $%d", len(args)+1), status)
	}
	if family := strings.TrimSpace(input.SourceFamily); family != "" {
		add(fmt.Sprintf("EXISTS (SELECT 1 FROM sensor_template_variants variant WHERE variant.template_id=sensor_templates.id AND variant.source_family=$%d AND variant.status='active')", len(args)+1), family)
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

type sensorTemplateScanner interface {
	Scan(...any) error
}

func scanPlatformSensorTemplate(scanner sensorTemplateScanner, externalDeviceType *string) (THCPNSensorTemplate, error) {
	var item THCPNSensorTemplate
	var description, port, driver sql.NullString
	var portNumsRaw, paramsRaw, metricsRaw []byte
	var createdAt, updatedAt time.Time
	if err := scanner.Scan(&item.ID, &item.SensorType, &description, &port, &item.PortNum, &driver,
		&portNumsRaw, &paramsRaw, &metricsRaw, &item.Status, &createdAt, &updatedAt); err != nil {
		return THCPNSensorTemplate{}, err
	}
	item.Description = nullableString(description)
	item.Port = nullableString(port)
	item.Driver = nullableString(driver)
	item.CreatedAt, item.UpdatedAt = &createdAt, &updatedAt
	item.Valid = true
	item.PortNums = []int{}
	item.Params = map[string]any{}
	if err := json.Unmarshal(portNumsRaw, &item.PortNums); err != nil {
		item.Valid = false
		item.Warnings = append(item.Warnings, QueryWarning{Code: "invalid_port_nums", Message: "sensor template port_nums is invalid JSON"})
	}
	if err := json.Unmarshal(paramsRaw, &item.Params); err != nil {
		item.Valid = false
		item.Warnings = append(item.Warnings, QueryWarning{Code: "invalid_params", Message: "sensor template params is invalid JSON"})
	}
	var metricMaps []map[string]any
	_ = json.Unmarshal(metricsRaw, &metricMaps)
	item.Metrics = sensorMetricsFromMaps(metricMaps)
	if len(item.Metrics) == 0 {
		item.Metrics = sensorMetricsFromParams(item.Params)
	}
	item.Variants = map[string]map[string]any{}
	item.ConfigEntry = map[string]any{
		"id": item.ID, "sensorType": item.SensorType, "description": item.Description,
		"port": item.Port, "port_num": item.PortNum, "port_nums": item.PortNums,
		"sensor": item.Driver, "params": item.Params,
		"created_at": createdAt.Format(time.RFC3339),
	}
	if externalDeviceType != nil && strings.TrimSpace(*externalDeviceType) != "" {
		item.ConfigEntry["sensor_type"] = strings.TrimSpace(*externalDeviceType)
	}
	return item, nil
}

func validateSensorTemplateWrite(input THCPNSensorTemplateWriteInput) error {
	if strings.TrimSpace(input.SensorType) == "" {
		return apperr.New(apperr.KindInvalidArgument, "sensor type is required")
	}
	status := normalizeSensorTemplateStatus(input.Status)
	if status != "active" && status != "disabled" {
		return apperr.New(apperr.KindInvalidArgument, "invalid sensor template status")
	}
	if err := validateSensorTemplateVariants(input); err != nil {
		return err
	}
	return nil
}

func validateSensorTemplateVariants(input THCPNSensorTemplateWriteInput) error {
	if len(input.Variants) > 1 {
		return apperr.New(apperr.KindInvalidArgument, "V1 and V2 sensor templates must be created separately")
	}
	defined := map[string]bool{}
	metrics := input.Metrics
	if len(metrics) == 0 {
		metrics = metricMapsFromParams(input.Params)
	}
	for _, metric := range metrics {
		key := strings.TrimSpace(stringValue(metric["key"]))
		name := strings.TrimSpace(stringValue(metric["name"]))
		if info, ok := metric["info"].(map[string]any); ok && name == "" {
			name = strings.TrimSpace(stringValue(info["name"]))
		}
		if key == "" || name == "" {
			return apperr.New(apperr.KindInvalidArgument, "every sensor metric requires key and name")
		}
		if defined[key] {
			return apperr.New(apperr.KindInvalidArgument, "duplicate sensor metric key: "+key)
		}
		defined[key] = true
	}
	for family, config := range input.Variants {
		if family != "thcpn" && family != "lorawan_v2" {
			return apperr.New(apperr.KindInvalidArgument, "unsupported sensor template source_family")
		}
		if family != "lorawan_v2" {
			continue
		}
		content, ok := config["content"].([]any)
		if !ok || len(content) == 0 {
			return apperr.New(apperr.KindInvalidArgument, "lorawan_v2 variant content is required")
		}
		units, err := parseLoRaWANV2MetricUnits(mustJSON(map[string]any{"content": content}))
		if err != nil {
			return err
		}
		if err := validateLoRaWANV2Resources(content); err != nil {
			return err
		}
		if len(units) != len(defined) {
			return apperr.New(apperr.KindInvalidArgument, "lorawan_v2 variant metric keys must match template metrics")
		}
		for key := range units {
			if !defined[key] {
				return apperr.New(apperr.KindInvalidArgument, "lorawan_v2 variant contains unknown metric: "+key)
			}
		}
	}
	return nil
}

func normalizeSensorTemplateStatus(status string) string {
	if strings.TrimSpace(status) == "" {
		return "active"
	}
	return strings.TrimSpace(status)
}

func nullableUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func decodeFlexibleJSON(raw string, target any) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" {
		return nil
	}
	var decoded any
	if err := json.Unmarshal([]byte(trimmed), &decoded); err != nil {
		return err
	}
	if encoded, ok := decoded.(string); ok {
		trimmed = encoded
	}
	if err := json.Unmarshal([]byte(trimmed), target); err != nil {
		return fmt.Errorf("decode nested JSON: %w", err)
	}
	return nil
}

func sensorMetricsFromParams(params map[string]any) []THCPNSensorMetric {
	contents, _ := params["contents"].([]any)
	maps := make([]map[string]any, 0, len(contents))
	for _, raw := range contents {
		if entry, ok := raw.(map[string]any); ok {
			maps = append(maps, entry)
		}
	}
	return sensorMetricsFromMaps(maps)
}

func metricMapsFromParams(params map[string]any) []map[string]any {
	contents, _ := params["contents"].([]any)
	result := make([]map[string]any, 0, len(contents))
	for _, raw := range contents {
		if entry, ok := raw.(map[string]any); ok {
			result = append(result, entry)
		}
	}
	return result
}

func sensorMetricsFromMaps(contents []map[string]any) []THCPNSensorMetric {
	metrics := make([]THCPNSensorMetric, 0, len(contents))
	for _, entry := range contents {
		info, _ := entry["info"].(map[string]any)
		metric := THCPNSensorMetric{Key: stringValue(entry["key"]), Decode: stringValue(entry["decode"]), Raw: entry}
		metric.Name, metric.Type, metric.Unit = stringValue(info["name"]), stringValue(info["type"]), stringValue(info["unit"])
		metric.Index, metric.Min, metric.Max = info["index"], info["min"], info["max"]
		if metric.Name == "" {
			metric.Name = stringValue(entry["name"])
		}
		if metric.Type == "" {
			metric.Type = stringValue(entry["type"])
		}
		if metric.Unit == "" {
			metric.Unit = stringValue(entry["unit"])
		}
		if metric.Index == nil {
			metric.Index = entry["index"]
		}
		if metric.Min == nil {
			metric.Min = entry["min"]
		}
		if metric.Max == nil {
			metric.Max = entry["max"]
		}
		metrics = append(metrics, metric)
	}
	return metrics
}

func (s *Service) loadSensorTemplateVariants(ctx context.Context, item *THCPNSensorTemplate) error {
	rows, err := s.db.Query(ctx, `SELECT source_family,config FROM sensor_template_variants WHERE template_id=$1 AND status='active'`, item.ID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list sensor template variants", err)
	}
	defer rows.Close()
	for rows.Next() {
		var family string
		var raw []byte
		if err := rows.Scan(&family, &raw); err != nil {
			return err
		}
		var config map[string]any
		if err := json.Unmarshal(raw, &config); err != nil {
			return apperr.Wrap(apperr.KindInternal, "decode sensor template variant", err)
		}
		item.Variants[family] = config
	}
	return rows.Err()
}

type sensorTemplateVariantExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func upsertSensorTemplateVariants(ctx context.Context, db sensorTemplateVariantExecer, id int64, input THCPNSensorTemplateWriteInput) error {
	variants := input.Variants
	if variants == nil {
		variants = map[string]map[string]any{}
	}
	if len(variants) == 0 {
		variants["thcpn"] = map[string]any{"port": input.Port, "port_num": input.PortNum, "port_nums": input.PortNums, "driver": input.Driver, "params": input.Params}
	}
	for family, config := range variants {
		raw, _ := json.Marshal(config)
		if _, err := db.Exec(ctx, `INSERT INTO sensor_template_variants(template_id,source_family,config) VALUES($1,$2,$3) ON CONFLICT(template_id,source_family) DO UPDATE SET config=EXCLUDED.config,status='active',updated_at=now()`, id, family, raw); err != nil {
			return apperr.Wrap(apperr.KindInternal, "upsert sensor template variant", err)
		}
	}
	return nil
}

func mustJSON(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }

func nullableString(value sql.NullString) string {
	if value.Valid {
		return value.String
	}
	return ""
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}
