package platform

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"thcpn-gin/internal/apperr"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const maxSensorTemplatePageSize = 100

type TemplateValidator func(map[string]any, map[string]bool) error
type TemplateProjector func(SensorTemplate, *string) map[string]any

type SensorTemplateListInput struct {
	DeviceID     uuid.UUID
	Search       string
	Port         string
	Driver       string
	Status       string
	SourceFamily string
	Page         int
	PageSize     int
}
type SensorTemplateWriteInput struct {
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
type SensorTemplateImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
	Invalid  int `json:"invalid"`
}
type SensorMetric struct {
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
type SensorTemplate struct {
	ID          int64                     `json:"id"`
	SensorType  string                    `json:"sensor_type"`
	Description string                    `json:"description,omitempty"`
	Port        string                    `json:"port,omitempty"`
	PortNum     int64                     `json:"port_num"`
	Driver      string                    `json:"driver,omitempty"`
	PortNums    []int                     `json:"port_nums"`
	Params      map[string]any            `json:"params"`
	Status      string                    `json:"status"`
	Metrics     []SensorMetric            `json:"metrics"`
	Variants    map[string]map[string]any `json:"variants"`
	ConfigEntry map[string]any            `json:"config_entry"`
	Valid       bool                      `json:"valid"`
	Warnings    []QueryWarning            `json:"warnings,omitempty"`
	CreatedAt   *time.Time                `json:"created_at,omitempty"`
	UpdatedAt   *time.Time                `json:"updated_at,omitempty"`
}
type SensorTemplateListResponse struct {
	Items    []SensorTemplate `json:"items"`
	Total    int              `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"page_size"`
}

func (s *Service) ListSensorTemplates(ctx context.Context, input SensorTemplateListInput) (SensorTemplateListResponse, error) {
	var externalDeviceType *string
	if input.DeviceID != uuid.Nil {
		if s.SensorTargetResolver == nil {
			return SensorTemplateListResponse{}, apperr.New(apperr.KindInvalidArgument, "device sensor templates are not supported")
		}
		family, kind, err := s.SensorTargetResolver(ctx, input.DeviceID)
		if err != nil {
			return SensorTemplateListResponse{}, err
		}
		input.SourceFamily = family
		externalDeviceType = kind
	}

	page, pageSize := normalizeSensorTemplatePage(input.Page, input.PageSize)
	where, args := BuildSensorTemplateWhere(input)
	var total int
	if err := s.DB.QueryRow(ctx, "SELECT COUNT(*) FROM sensor_templates"+where, args...).Scan(&total); err != nil {
		return SensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "count sensor templates", err)
	}
	args = append(args, pageSize, (page-1)*pageSize)
	limitPosition := len(args) - 1
	rows, err := s.DB.Query(ctx, `SELECT id, sensor_type, description, port, port_num, driver, port_nums, params, metrics, status, created_at, updated_at
FROM sensor_templates`+where+fmt.Sprintf(` ORDER BY sensor_type, id LIMIT $%d OFFSET $%d`, limitPosition, limitPosition+1), args...)
	if err != nil {
		return SensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "list sensor templates", err)
	}
	defer rows.Close()

	items := make([]SensorTemplate, 0, pageSize)
	for rows.Next() {
		item, scanErr := scanPlatformSensorTemplate(rows)
		if scanErr != nil {
			return SensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "scan sensor template", scanErr)
		}
		if scanErr = s.loadSensorTemplateVariants(ctx, &item); scanErr != nil {
			return SensorTemplateListResponse{}, scanErr
		}
		s.projectSensorTemplate(&item, externalDeviceType)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return SensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "read sensor templates", err)
	}
	return SensorTemplateListResponse{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}
func (s *Service) GetSensorTemplate(ctx context.Context, id int64) (SensorTemplate, error) {
	item, err := scanPlatformSensorTemplate(s.DB.QueryRow(ctx, `SELECT id, sensor_type, description, port, port_num, driver, port_nums, params, metrics, status, created_at, updated_at
FROM sensor_templates WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return SensorTemplate{}, apperr.New(apperr.KindNotFound, "sensor template not found")
	}
	if err != nil {
		return SensorTemplate{}, apperr.Wrap(apperr.KindInternal, "get sensor template", err)
	}
	if err := s.loadSensorTemplateVariants(ctx, &item); err != nil {
		return SensorTemplate{}, err
	}
	s.projectSensorTemplate(&item, nil)
	return item, nil
}
func (s *Service) CreateSensorTemplate(ctx context.Context, input SensorTemplateWriteInput) (SensorTemplate, error) {
	if err := ValidateSensorTemplateWrite(input, s.TemplateValidators); err != nil {
		return SensorTemplate{}, err
	}
	portNums, _ := json.Marshal(input.PortNums)
	params, _ := json.Marshal(input.Params)
	metrics := input.Metrics
	if len(metrics) == 0 {
		metrics = MetricMapsFromParams(input.Params)
	}
	metricsRaw, _ := json.Marshal(metrics)
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SensorTemplate{}, apperr.Wrap(apperr.KindInternal, "begin sensor template create", err)
	}
	defer tx.Rollback(context.Background())
	var id int64
	err = tx.QueryRow(ctx, `INSERT INTO sensor_templates
(sensor_type, description, port, port_num, driver, port_nums, params, metrics, status, created_by, updated_by)
VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7, $8, $9, $10, $10)
RETURNING id`, strings.TrimSpace(input.SensorType), strings.TrimSpace(input.Description), strings.TrimSpace(input.Port),
		input.PortNum, strings.TrimSpace(input.Driver), string(portNums), string(params), string(metricsRaw), normalizeSensorTemplateStatus(input.Status), NullableUUID(input.ActorID)).Scan(&id)
	if err != nil {
		return SensorTemplate{}, apperr.Wrap(apperr.KindInternal, "create sensor template", err)
	}
	if err := UpsertSensorTemplateVariants(ctx, tx, id, input); err != nil {
		return SensorTemplate{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SensorTemplate{}, apperr.Wrap(apperr.KindInternal, "commit sensor template create", err)
	}
	return s.GetSensorTemplate(ctx, id)
}
func (s *Service) UpdateSensorTemplate(ctx context.Context, id int64, input SensorTemplateWriteInput) (SensorTemplate, error) {
	if err := ValidateSensorTemplateWrite(input, s.TemplateValidators); err != nil {
		return SensorTemplate{}, err
	}
	portNums, _ := json.Marshal(input.PortNums)
	params, _ := json.Marshal(input.Params)
	metrics := input.Metrics
	if len(metrics) == 0 {
		metrics = MetricMapsFromParams(input.Params)
	}
	metricsRaw, _ := json.Marshal(metrics)
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SensorTemplate{}, apperr.Wrap(apperr.KindInternal, "begin sensor template update", err)
	}
	defer tx.Rollback(context.Background())
	var currentFamily string
	if err := tx.QueryRow(ctx, `SELECT source_family FROM sensor_template_variants WHERE template_id=$1 FOR UPDATE`, id).Scan(&currentFamily); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SensorTemplate{}, apperr.New(apperr.KindNotFound, "sensor template not found")
		}
		return SensorTemplate{}, apperr.Wrap(apperr.KindInternal, "read sensor template version", err)
	}
	nextFamily := ""
	for family := range input.Variants {
		nextFamily = family
	}
	if currentFamily != nextFamily {
		return SensorTemplate{}, apperr.New(apperr.KindInvalidArgument, "sensor template version cannot be changed")
	}
	tag, err := tx.Exec(ctx, `UPDATE sensor_templates SET
sensor_type = $2, description = NULLIF($3, ''), port = NULLIF($4, ''), port_num = $5,
driver = NULLIF($6, ''), port_nums = $7, params = $8, metrics = $9, status = $10,
updated_by = $11, updated_at = now()
WHERE id = $1`, id, strings.TrimSpace(input.SensorType), strings.TrimSpace(input.Description), strings.TrimSpace(input.Port),
		input.PortNum, strings.TrimSpace(input.Driver), string(portNums), string(params), string(metricsRaw), normalizeSensorTemplateStatus(input.Status), NullableUUID(input.ActorID))
	if err != nil {
		return SensorTemplate{}, apperr.Wrap(apperr.KindInternal, "update sensor template", err)
	}
	if tag.RowsAffected() == 0 {
		return SensorTemplate{}, apperr.New(apperr.KindNotFound, "sensor template not found")
	}
	if err := UpsertSensorTemplateVariants(ctx, tx, id, input); err != nil {
		return SensorTemplate{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SensorTemplate{}, apperr.Wrap(apperr.KindInternal, "commit sensor template update", err)
	}
	return s.GetSensorTemplate(ctx, id)
}
func (s *Service) DeleteSensorTemplate(ctx context.Context, id int64) error {
	tag, err := s.DB.Exec(ctx, "DELETE FROM sensor_templates WHERE id = $1", id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete sensor template", err)
	}
	if tag.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "sensor template not found")
	}
	return nil
}
func normalizeSensorTemplatePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > maxSensorTemplatePageSize {
		pageSize = maxSensorTemplatePageSize
	}
	return page, pageSize
}
func BuildSensorTemplateWhere(input SensorTemplateListInput) (string, []any) {
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

func scanPlatformSensorTemplate(scanner sensorTemplateScanner) (SensorTemplate, error) {
	var item SensorTemplate
	var description, port, driver sql.NullString
	var portNumsRaw, paramsRaw, metricsRaw []byte
	var createdAt, updatedAt time.Time
	if err := scanner.Scan(&item.ID, &item.SensorType, &description, &port, &item.PortNum, &driver,
		&portNumsRaw, &paramsRaw, &metricsRaw, &item.Status, &createdAt, &updatedAt); err != nil {
		return SensorTemplate{}, err
	}
	item.Description = NullableString(description)
	item.Port = NullableString(port)
	item.Driver = NullableString(driver)
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
	item.Metrics = SensorMetricsFromMaps(metricMaps)
	if len(item.Metrics) == 0 {
		item.Metrics = SensorMetricsFromParams(item.Params)
	}
	item.Variants = map[string]map[string]any{}
	item.ConfigEntry = map[string]any{}
	return item, nil
}
func ValidateSensorTemplateWrite(input SensorTemplateWriteInput, validators ...map[string]TemplateValidator) error {
	if strings.TrimSpace(input.SensorType) == "" {
		return apperr.New(apperr.KindInvalidArgument, "sensor type is required")
	}
	status := normalizeSensorTemplateStatus(input.Status)
	if status != "active" && status != "disabled" {
		return apperr.New(apperr.KindInvalidArgument, "invalid sensor template status")
	}
	if err := validateSensorTemplateVariants(input, validators...); err != nil {
		return err
	}
	return nil
}
func validateSensorTemplateVariants(input SensorTemplateWriteInput, choices ...map[string]TemplateValidator) error {
	validators := map[string]TemplateValidator{}
	if len(choices) > 0 {
		validators = choices[0]
	}
	if len(input.Variants) != 1 {
		return apperr.New(apperr.KindInvalidArgument, "exactly one source variant is required")
	}
	defined := map[string]bool{}
	metrics := input.Metrics
	if len(metrics) == 0 {
		metrics = MetricMapsFromParams(input.Params)
	}
	for _, metric := range metrics {
		key := strings.TrimSpace(StringValue(metric["key"]))
		name := strings.TrimSpace(StringValue(metric["name"]))
		if info, ok := metric["info"].(map[string]any); ok && name == "" {
			name = strings.TrimSpace(StringValue(info["name"]))
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
		validate := validators[family]
		if validate == nil {
			return apperr.New(apperr.KindInvalidArgument, "unsupported sensor template source family")
		}
		if err := validate(config, defined); err != nil {
			return err
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
func NullableUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}
func DecodeFlexibleJSON(raw string, target any) error {
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
func SensorMetricsFromParams(params map[string]any) []SensorMetric {
	contents, _ := params["contents"].([]any)
	maps := make([]map[string]any, 0, len(contents))
	for _, raw := range contents {
		if entry, ok := raw.(map[string]any); ok {
			maps = append(maps, entry)
		}
	}
	return SensorMetricsFromMaps(maps)
}
func MetricMapsFromParams(params map[string]any) []map[string]any {
	contents, _ := params["contents"].([]any)
	result := make([]map[string]any, 0, len(contents))
	for _, raw := range contents {
		if entry, ok := raw.(map[string]any); ok {
			result = append(result, entry)
		}
	}
	return result
}
func SensorMetricsFromMaps(contents []map[string]any) []SensorMetric {
	metrics := make([]SensorMetric, 0, len(contents))
	for _, entry := range contents {
		info, _ := entry["info"].(map[string]any)
		metric := SensorMetric{Key: StringValue(entry["key"]), Decode: StringValue(entry["decode"]), Raw: entry}
		metric.Name, metric.Type, metric.Unit = StringValue(info["name"]), StringValue(info["type"]), StringValue(info["unit"])
		metric.Index, metric.Min, metric.Max = info["index"], info["min"], info["max"]
		if metric.Name == "" {
			metric.Name = StringValue(entry["name"])
		}
		if metric.Type == "" {
			metric.Type = StringValue(entry["type"])
		}
		if metric.Unit == "" {
			metric.Unit = StringValue(entry["unit"])
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
func (s *Service) loadSensorTemplateVariants(ctx context.Context, item *SensorTemplate) error {
	rows, err := s.DB.Query(ctx, `SELECT source_family,config FROM sensor_template_variants WHERE template_id=$1 AND status='active'`, item.ID)
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

func UpsertSensorTemplateVariants(ctx context.Context, db sensorTemplateVariantExecer, id int64, input SensorTemplateWriteInput) error {
	variants := input.Variants
	for family, config := range variants {
		raw, _ := json.Marshal(config)
		if _, err := db.Exec(ctx, `INSERT INTO sensor_template_variants(template_id,source_family,config) VALUES($1,$2,$3) ON CONFLICT(template_id,source_family) DO UPDATE SET config=EXCLUDED.config,status='active',updated_at=now()`, id, family, raw); err != nil {
			return apperr.Wrap(apperr.KindInternal, "upsert sensor template variant", err)
		}
	}
	return nil
}
func MustJSON(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }
func NullableString(value sql.NullString) string {
	if value.Valid {
		return value.String
	}
	return ""
}
func StringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}

func (s *Service) projectSensorTemplate(item *SensorTemplate, deviceType *string) {
	for family := range item.Variants {
		if project := s.TemplateProjectors[family]; project != nil {
			item.ConfigEntry = project(*item, deviceType)
			return
		}
	}
}
