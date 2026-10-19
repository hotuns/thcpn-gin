package thcpn

import (
	"strings"
	"thcpn-gin/internal/datasource/platform"
	"time"
)

func ProjectTemplate(item platform.SensorTemplate, externalType *string) map[string]any {
	created := ""
	if item.CreatedAt != nil {
		created = item.CreatedAt.Format(time.RFC3339)
	}
	entry := map[string]any{"id": item.ID, "sensorType": item.SensorType, "description": item.Description, "port": item.Port, "port_num": item.PortNum, "port_nums": item.PortNums, "sensor": item.Driver, "params": item.Params, "created_at": created}
	if externalType != nil && strings.TrimSpace(*externalType) != "" {
		entry["sensor_type"] = strings.TrimSpace(*externalType)
	}
	return entry
}
func SourceTemplateVariant(input platform.SensorTemplateWriteInput) map[string]map[string]any {
	return map[string]map[string]any{"thcpn": {"port": input.Port, "port_num": input.PortNum, "port_nums": input.PortNums, "driver": input.Driver, "params": input.Params}}
}
