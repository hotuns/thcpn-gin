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

	"thcpn-gin/internal/apperr"
)

const maxTHCPNSensorTemplatePageSize = 100

type THCPNSensorTemplateListInput struct {
	DeviceID uuid.UUID
	Search   string
	Port     string
	Driver   string
	Status   string
	Page     int
	PageSize int
}

type THCPNSensorTemplateWriteInput struct {
	SensorType  string
	Description string
	Port        string
	PortNum     int64
	Driver      string
	PortNums    []int
	Params      map[string]any
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
	ID          int64               `json:"id"`
	SensorType  string              `json:"sensor_type"`
	Description string              `json:"description,omitempty"`
	Port        string              `json:"port,omitempty"`
	PortNum     int64               `json:"port_num"`
	Driver      string              `json:"driver,omitempty"`
	PortNums    []int               `json:"port_nums"`
	Params      map[string]any      `json:"params"`
	Status      string              `json:"status"`
	Metrics     []THCPNSensorMetric `json:"metrics"`
	ConfigEntry map[string]any      `json:"config_entry"`
	Valid       bool                `json:"valid"`
	Warnings    []QueryWarning      `json:"warnings,omitempty"`
	CreatedAt   *time.Time          `json:"created_at,omitempty"`
	UpdatedAt   *time.Time          `json:"updated_at,omitempty"`
}

type THCPNSensorTemplateListResponse struct {
	Items    []THCPNSensorTemplate `json:"items"`
	Total    int                   `json:"total"`
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
}

func (s *Service) ListTHCPNSensorTemplates(ctx context.Context, input THCPNSensorTemplateListInput) (THCPNSensorTemplateListResponse, error) {
	var externalDeviceType *string
	if input.DeviceID != uuid.Nil {
		db, ref, err := s.openTHCPNDevice(ctx, input.DeviceID)
		if err == nil {
			defer db.Close()
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
	rows, err := s.db.Query(ctx, `SELECT id, sensor_type, description, port, port_num, driver, port_nums, params, status, created_at, updated_at
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
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindInternal, "read sensor templates", err)
	}
	return THCPNSensorTemplateListResponse{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) GetTHCPNSensorTemplate(ctx context.Context, id int64) (THCPNSensorTemplate, error) {
	item, err := scanPlatformSensorTemplate(s.db.QueryRow(ctx, `SELECT id, sensor_type, description, port, port_num, driver, port_nums, params, status, created_at, updated_at
FROM sensor_templates WHERE id = $1`, id), nil)
	if errors.Is(err, pgx.ErrNoRows) {
		return THCPNSensorTemplate{}, apperr.New(apperr.KindNotFound, "sensor template not found")
	}
	if err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "get sensor template", err)
	}
	return item, nil
}

func (s *Service) CreateTHCPNSensorTemplate(ctx context.Context, input THCPNSensorTemplateWriteInput) (THCPNSensorTemplate, error) {
	if err := validateSensorTemplateWrite(input); err != nil {
		return THCPNSensorTemplate{}, err
	}
	portNums, _ := json.Marshal(input.PortNums)
	params, _ := json.Marshal(input.Params)
	var id int64
	err := s.db.QueryRow(ctx, `INSERT INTO sensor_templates
(sensor_type, description, port, port_num, driver, port_nums, params, status, created_by, updated_by)
VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7, $8, $9, $9)
RETURNING id`, strings.TrimSpace(input.SensorType), strings.TrimSpace(input.Description), strings.TrimSpace(input.Port),
		input.PortNum, strings.TrimSpace(input.Driver), string(portNums), string(params), normalizeSensorTemplateStatus(input.Status), nullableUUID(input.ActorID)).Scan(&id)
	if err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "create sensor template", err)
	}
	return s.GetTHCPNSensorTemplate(ctx, id)
}

func (s *Service) UpdateTHCPNSensorTemplate(ctx context.Context, id int64, input THCPNSensorTemplateWriteInput) (THCPNSensorTemplate, error) {
	if err := validateSensorTemplateWrite(input); err != nil {
		return THCPNSensorTemplate{}, err
	}
	portNums, _ := json.Marshal(input.PortNums)
	params, _ := json.Marshal(input.Params)
	tag, err := s.db.Exec(ctx, `UPDATE sensor_templates SET
sensor_type = $2, description = NULLIF($3, ''), port = NULLIF($4, ''), port_num = $5,
driver = NULLIF($6, ''), port_nums = $7, params = $8, status = $9,
updated_by = $10, updated_at = now()
WHERE id = $1`, id, strings.TrimSpace(input.SensorType), strings.TrimSpace(input.Description), strings.TrimSpace(input.Port),
		input.PortNum, strings.TrimSpace(input.Driver), string(portNums), string(params), normalizeSensorTemplateStatus(input.Status), nullableUUID(input.ActorID))
	if err != nil {
		return THCPNSensorTemplate{}, apperr.Wrap(apperr.KindInternal, "update sensor template", err)
	}
	if tag.RowsAffected() == 0 {
		return THCPNSensorTemplate{}, apperr.New(apperr.KindNotFound, "sensor template not found")
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
	defer sourceDB.Close()
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
		tag, insertErr := s.db.Exec(ctx, `INSERT INTO sensor_templates
(sensor_type, description, port, port_num, driver, port_nums, params, status, created_by, updated_by)
SELECT $1, NULLIF($2, ''), NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7, 'active', $8, $8
WHERE NOT EXISTS (
  SELECT 1 FROM sensor_templates
  WHERE sensor_type = $1 AND port IS NOT DISTINCT FROM NULLIF($3, '')
    AND driver IS NOT DISTINCT FROM NULLIF($5, '') AND params = $7::jsonb
)`, strings.TrimSpace(sensorType), nullableString(description), nullableString(port), portNum.Int64,
			nullableString(driver), string(portNumsJSON), string(paramsJSON), nullableUUID(actorID))
		if insertErr != nil {
			return result, apperr.Wrap(apperr.KindInternal, "import sensor template", insertErr)
		}
		if tag.RowsAffected() == 0 {
			result.Skipped++
		} else {
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
	var portNumsRaw, paramsRaw []byte
	var createdAt, updatedAt time.Time
	if err := scanner.Scan(&item.ID, &item.SensorType, &description, &port, &item.PortNum, &driver,
		&portNumsRaw, &paramsRaw, &item.Status, &createdAt, &updatedAt); err != nil {
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
	item.Metrics = sensorMetricsFromParams(item.Params)
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
	metrics := make([]THCPNSensorMetric, 0, len(contents))
	for _, raw := range contents {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		info, _ := entry["info"].(map[string]any)
		metric := THCPNSensorMetric{Key: stringValue(entry["key"]), Decode: stringValue(entry["decode"]), Raw: entry}
		metric.Name, metric.Type, metric.Unit = stringValue(info["name"]), stringValue(info["type"]), stringValue(info["unit"])
		metric.Index, metric.Min, metric.Max = info["index"], info["min"], info["max"]
		metrics = append(metrics, metric)
	}
	return metrics
}

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
