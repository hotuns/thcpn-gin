package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

const maxTHCPNSensorTemplatePageSize = 100

type THCPNSensorTemplateListInput struct {
	DeviceID uuid.UUID
	Search   string
	Port     string
	Driver   string
	Page     int
	PageSize int
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
	if input.DeviceID == uuid.Nil {
		return THCPNSensorTemplateListResponse{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	page := input.Page
	if page <= 0 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > maxTHCPNSensorTemplatePageSize {
		pageSize = maxTHCPNSensorTemplatePageSize
	}

	db, ref, err := s.openTHCPNDevice(ctx, input.DeviceID)
	if err != nil {
		return THCPNSensorTemplateListResponse{}, err
	}
	defer db.Close()
	externalDevice, err := readTHCPNExternalDevice(ctx, db, ref.ExternalDeviceID)
	if err != nil {
		return THCPNSensorTemplateListResponse{}, err
	}

	where, args := buildSensorTemplateWhere(input)
	var total int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sensors"+where, args...).Scan(&total); err != nil {
		return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindDataSource, "count thcpn sensor templates", err)
	}
	queryArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := db.QueryContext(ctx, `SELECT id, sensor_type, description, port, port_num, sensor, port_nums, params, created_at, updated_at
FROM sensors`+where+` ORDER BY sensor_type, id LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindDataSource, "list thcpn sensor templates", err)
	}
	defer rows.Close()

	items := make([]THCPNSensorTemplate, 0, pageSize)
	for rows.Next() {
		item, err := scanTHCPNSensorTemplate(rows, externalDevice.DeviceType)
		if err != nil {
			return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindDataSource, "scan thcpn sensor template", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return THCPNSensorTemplateListResponse{}, apperr.Wrap(apperr.KindDataSource, "read thcpn sensor templates", err)
	}
	return THCPNSensorTemplateListResponse{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func buildSensorTemplateWhere(input THCPNSensorTemplateListInput) (string, []any) {
	clauses := []string{" WHERE deleted_at IS NULL"}
	args := make([]any, 0, 5)
	if search := strings.TrimSpace(input.Search); search != "" {
		clauses = append(clauses, " AND (sensor_type LIKE ? OR description LIKE ? OR sensor LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	if port := strings.TrimSpace(input.Port); port != "" {
		clauses = append(clauses, " AND port = ?")
		args = append(args, port)
	}
	if driver := strings.TrimSpace(input.Driver); driver != "" {
		clauses = append(clauses, " AND sensor = ?")
		args = append(args, driver)
	}
	return strings.Join(clauses, ""), args
}

type sensorTemplateScanner interface {
	Scan(...any) error
}

func scanTHCPNSensorTemplate(scanner sensorTemplateScanner, externalDeviceType *string) (THCPNSensorTemplate, error) {
	var item THCPNSensorTemplate
	var description, port, driver, portNumsRaw, paramsRaw sql.NullString
	var portNum sql.NullInt64
	var createdAt, updatedAt sql.NullTime
	if err := scanner.Scan(&item.ID, &item.SensorType, &description, &port, &portNum, &driver, &portNumsRaw, &paramsRaw, &createdAt, &updatedAt); err != nil {
		return THCPNSensorTemplate{}, err
	}
	item.Description = nullableString(description)
	item.Port = nullableString(port)
	item.Driver = nullableString(driver)
	if portNum.Valid {
		item.PortNum = portNum.Int64
	}
	item.CreatedAt = nullTimePtr(createdAt)
	item.UpdatedAt = nullTimePtr(updatedAt)
	item.Valid = true
	item.PortNums = []int{}
	item.Params = map[string]any{}

	if portNumsRaw.Valid && strings.TrimSpace(portNumsRaw.String) != "" {
		if err := decodeFlexibleJSON(portNumsRaw.String, &item.PortNums); err != nil {
			item.Valid = false
			item.Warnings = append(item.Warnings, QueryWarning{Code: "invalid_port_nums", Message: "sensor template port_nums is invalid JSON"})
		}
	}
	if paramsRaw.Valid && strings.TrimSpace(paramsRaw.String) != "" {
		if err := decodeFlexibleJSON(paramsRaw.String, &item.Params); err != nil {
			item.Valid = false
			item.Warnings = append(item.Warnings, QueryWarning{Code: "invalid_params", Message: "sensor template params is invalid JSON"})
		}
	}
	item.Metrics = sensorMetricsFromParams(item.Params)
	item.ConfigEntry = map[string]any{
		"id": item.ID, "sensorType": item.SensorType, "description": item.Description,
		"port": item.Port, "port_num": item.PortNum, "port_nums": item.PortNums,
		"sensor": item.Driver, "params": item.Params,
	}
	if item.CreatedAt != nil {
		item.ConfigEntry["created_at"] = item.CreatedAt.Format(time.RFC3339)
	}
	if externalDeviceType != nil && strings.TrimSpace(*externalDeviceType) != "" {
		item.ConfigEntry["sensor_type"] = strings.TrimSpace(*externalDeviceType)
	}
	return item, nil
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
