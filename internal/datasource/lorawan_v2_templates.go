package datasource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
)

type loraWANV2MetricSemantic struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
	Unit string `json:"unit,omitempty"`
}

type loraWANV2CompiledConfig struct {
	WaitTime  int                       `json:"wait_time"`
	Content   []any                     `json:"content"`
	Instances []map[string]any          `json:"template_instances"`
	Metrics   []loraWANV2MetricSemantic `json:"metrics"`
	Status    string                    `json:"management_status"`
}

func (s *Service) compileLoRaWANV2NodeConfig(ctx context.Context, raw any) (loraWANV2CompiledConfig, error) {
	input, ok := raw.(map[string]any)
	if !ok {
		return loraWANV2CompiledConfig{}, apperr.New(apperr.KindInvalidArgument, "invalid lorawan_v2 sensor configuration")
	}
	mode := strings.TrimSpace(stringValue(input["mode"]))
	if mode == "" {
		mode = "advanced"
	}
	result := loraWANV2CompiledConfig{Status: "managed", Instances: []map[string]any{}, Metrics: []loraWANV2MetricSemantic{}}
	waitTimeProvided := false
	if value, ok := input["wait_time"].(float64); ok {
		result.WaitTime = int(value)
		waitTimeProvided = true
	}
	if result.WaitTime < 0 || result.WaitTime > 65535 {
		return result, apperr.New(apperr.KindInvalidArgument, "wait_time must be between 0 and 65535")
	}
	switch mode {
	case "templates":
		instances, ok := input["template_instances"].([]any)
		if !ok || len(instances) == 0 {
			return result, apperr.New(apperr.KindInvalidArgument, "at least one sensor template is required")
		}
		for _, rawInstance := range instances {
			instance, ok := rawInstance.(map[string]any)
			if !ok {
				return result, apperr.New(apperr.KindInvalidArgument, "invalid sensor template instance")
			}
			id := int64(0)
			if value, ok := instance["template_id"].(float64); ok {
				id = int64(value)
			}
			if id <= 0 {
				return result, apperr.New(apperr.KindInvalidArgument, "template_id is required")
			}
			template, err := s.GetTHCPNSensorTemplate(ctx, id)
			if err != nil {
				return result, err
			}
			variant, ok := template.Variants["lorawan_v2"]
			if !ok {
				return result, apperr.New(apperr.KindInvalidArgument, "sensor template has no lorawan_v2 variant")
			}
			content := variant["content"]
			if override, exists := instance["content"]; exists {
				content = override
			}
			items, ok := content.([]any)
			if !ok || len(items) == 0 {
				return result, apperr.New(apperr.KindInvalidArgument, "lorawan_v2 template content is invalid")
			}
			result.Content = append(result.Content, items...)
			suggested := int(numberValue(variant["wait_time"]))
			if !waitTimeProvided && suggested > result.WaitTime {
				result.WaitTime = suggested
			}
			result.Instances = append(result.Instances, map[string]any{"template_id": id, "sensor_type": template.SensorType, "content": items})
			for _, metric := range template.Metrics {
				if strings.TrimSpace(metric.Name) == "" {
					return result, apperr.New(apperr.KindInvalidArgument, "template metric name is required: "+metric.Key)
				}
				result.Metrics = append(result.Metrics, loraWANV2MetricSemantic{Key: metric.Key, Name: metric.Name, Type: metric.Type, Unit: metric.Unit})
			}
		}
	case "advanced":
		content, ok := input["content"].([]any)
		if !ok || len(content) == 0 {
			return result, apperr.New(apperr.KindInvalidArgument, "advanced content is required")
		}
		result.Content, result.Status = content, "managed"
		metrics, ok := input["metrics"].([]any)
		if !ok {
			return result, apperr.New(apperr.KindInvalidArgument, "advanced metric names are required")
		}
		for _, rawMetric := range metrics {
			metric, ok := rawMetric.(map[string]any)
			if !ok {
				return result, apperr.New(apperr.KindInvalidArgument, "invalid advanced metric")
			}
			item := loraWANV2MetricSemantic{Key: strings.TrimSpace(stringValue(metric["key"])), Name: strings.TrimSpace(stringValue(metric["name"])), Type: strings.TrimSpace(stringValue(metric["type"])), Unit: strings.TrimSpace(stringValue(metric["unit"]))}
			if item.Key == "" || item.Name == "" {
				return result, apperr.New(apperr.KindInvalidArgument, "every advanced metric requires key and name")
			}
			result.Metrics = append(result.Metrics, item)
		}
	default:
		return result, apperr.New(apperr.KindInvalidArgument, "sensor configuration mode must be templates or advanced")
	}
	units, err := parseLoRaWANV2MetricUnits(mustJSON(map[string]any{"content": result.Content}))
	if err != nil {
		return result, err
	}
	if err := validateLoRaWANV2Resources(result.Content); err != nil {
		return result, err
	}
	seen := map[string]bool{}
	for _, metric := range result.Metrics {
		if seen[metric.Key] {
			return result, apperr.New(apperr.KindInvalidArgument, "duplicate metric key: "+metric.Key)
		}
		if upstreamUnit := strings.TrimSpace(units[metric.Key]); upstreamUnit != "" && strings.TrimSpace(metric.Unit) != "" && upstreamUnit != strings.TrimSpace(metric.Unit) {
			return result, apperr.New(apperr.KindInvalidArgument, "metric unit does not match lorawan_v2 content: "+metric.Key)
		}
		seen[metric.Key] = true
	}
	if len(seen) != len(units) {
		return result, apperr.New(apperr.KindInvalidArgument, "metric definitions must exactly match lorawan_v2 content")
	}
	for key := range units {
		if !seen[key] {
			return result, apperr.New(apperr.KindInvalidArgument, "missing metric definition: "+key)
		}
	}
	return result, nil
}

func validateLoRaWANV2Resources(content []any) error {
	adPorts, iicAddresses := map[string]bool{}, map[string]bool{}
	for _, raw := range content {
		item, ok := raw.([]any)
		if !ok || len(item) < 2 {
			continue
		}
		switch stringValue(item[0]) {
		case "ad":
			if len(item) == 3 {
				key := stringValue(item[2])
				if adPorts[key] {
					return apperr.New(apperr.KindInvalidArgument, "duplicate lorawan_v2 AD port: "+key)
				}
				adPorts[key] = true
			}
		case "iic":
			inner, _ := item[1].([]any)
			if len(inner) >= 2 {
				key := strings.ToLower(strings.TrimSpace(stringValue(inner[1])))
				if iicAddresses[key] {
					return apperr.New(apperr.KindInvalidArgument, "duplicate lorawan_v2 IIC address: "+key)
				}
				iicAddresses[key] = true
			}
		}
	}
	return nil
}

func numberValue(value any) float64 {
	if number, ok := value.(float64); ok {
		return number
	}
	return 0
}

func (s *Service) saveLoRaWANV2NodeConfigSnapshot(ctx context.Context, deviceID uuid.UUID, nodeIndex int, upstreamID *int64, config loraWANV2CompiledConfig, actorID uuid.UUID) error {
	content, _ := json.Marshal(config.Content)
	instances, _ := json.Marshal(config.Instances)
	metrics, _ := json.Marshal(config.Metrics)
	normalized := append([]byte(nil), content...)
	var value any
	if json.Unmarshal(content, &value) == nil {
		normalized, _ = json.Marshal(value)
	}
	sum := sha256.Sum256(normalized)
	hash := hex.EncodeToString(sum[:])
	_, err := s.db.Exec(ctx, `INSERT INTO lorawan_v2_node_config_snapshots(device_id,node_index,upstream_config_id,content_hash,wait_time,content_json,template_instances,metrics_json,management_status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, deviceID, nodeIndex, upstreamID, hash, config.WaitTime, content, instances, metrics, config.Status, nullableUUID(actorID))
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "save lorawan_v2 node configuration snapshot", err)
	}
	return nil
}

func (s *Service) enrichLoRaWANV2StreamSpecs(ctx context.Context, deviceID uuid.UUID, specs []loraWANV2StreamSpec) []loraWANV2StreamSpec {
	rows, err := s.db.Query(ctx, `SELECT DISTINCT ON (node_index,content_hash) node_index,content_hash,metrics_json FROM lorawan_v2_node_config_snapshots WHERE device_id=$1 ORDER BY node_index,content_hash,created_at DESC`, deviceID)
	if err != nil {
		return specs
	}
	defer rows.Close()
	semantic := map[string]loraWANV2MetricSemantic{}
	for rows.Next() {
		var node int
		var hash string
		var raw []byte
		if rows.Scan(&node, &hash, &raw) != nil {
			continue
		}
		var metrics []loraWANV2MetricSemantic
		if json.Unmarshal(raw, &metrics) != nil {
			continue
		}
		for _, metric := range metrics {
			semantic[strconv.Itoa(node)+"\x00"+hash+"\x00"+metric.Key] = metric
		}
	}
	for index := range specs {
		var cfg loraWANV2TelemetryConfig
		if json.Unmarshal(specs[index].AdapterConfig, &cfg) != nil || cfg.NodeIndex == nil {
			continue
		}
		if metric, ok := semantic[strconv.Itoa(*cfg.NodeIndex)+"\x00"+specs[index].ConfigHash+"\x00"+cfg.Metric]; ok {
			specs[index].Name = metric.Name
			if metric.Unit != "" {
				specs[index].Unit = metric.Unit
			}
		}
	}
	sort.SliceStable(specs, func(i, j int) bool { return specs[i].Code < specs[j].Code })
	return specs
}

func (s *Service) describeLoRaWANV2NodeConfig(ctx context.Context, deviceID uuid.UUID, nodeIndex int, payload json.RawMessage) (json.RawMessage, error) {
	var item map[string]any
	if json.Unmarshal(payload, &item) != nil {
		return payload, nil
	}
	if data, ok := item["data"].([]any); ok {
		for index, raw := range data {
			encoded, _ := json.Marshal(raw)
			described, _ := s.describeLoRaWANV2NodeConfig(ctx, deviceID, nodeIndex, encoded)
			var value any
			if json.Unmarshal(described, &value) == nil {
				data[index] = value
			}
		}
		item["data"] = data
		return json.Marshal(item)
	}
	content, ok := item["content"].([]any)
	if !ok {
		return payload, nil
	}
	rawContent, _ := json.Marshal(content)
	var normalized any
	_ = json.Unmarshal(rawContent, &normalized)
	rawContent, _ = json.Marshal(normalized)
	sum := sha256.Sum256(rawContent)
	hash := hex.EncodeToString(sum[:])
	var instancesRaw, metricsRaw []byte
	var status string
	var upstreamID *int64
	configID := int64(numberValue(item["id"]))
	var err error
	if configID > 0 {
		err = s.db.QueryRow(ctx, `SELECT upstream_config_id,template_instances,metrics_json,management_status FROM lorawan_v2_node_config_snapshots WHERE device_id=$1 AND node_index=$2 AND upstream_config_id=$3 AND content_hash=$4 ORDER BY created_at DESC LIMIT 1`, deviceID, nodeIndex, configID, hash).Scan(&upstreamID, &instancesRaw, &metricsRaw, &status)
	}
	if configID == 0 || err != nil {
		err = s.db.QueryRow(ctx, `SELECT upstream_config_id,template_instances,metrics_json,management_status FROM lorawan_v2_node_config_snapshots WHERE device_id=$1 AND node_index=$2 AND content_hash=$3 ORDER BY created_at DESC LIMIT 1`, deviceID, nodeIndex, hash).Scan(&upstreamID, &instancesRaw, &metricsRaw, &status)
	}
	if err != nil {
		instances, metrics, matched := s.matchLoRaWANV2TemplateSequence(ctx, content)
		if matched {
			instancesRaw, _ = json.Marshal(instances)
			metricsRaw, _ = json.Marshal(metrics)
			status = "matched"
			if configID > 0 {
				upstreamID = &configID
			}
			_ = s.saveLoRaWANV2NodeConfigSnapshot(ctx, deviceID, nodeIndex, upstreamID, loraWANV2CompiledConfig{
				WaitTime: int(numberValue(item["wait_time"])), Content: content, Instances: instances, Metrics: metrics, Status: status,
			}, uuid.Nil)
		} else {
			instancesRaw = []byte("[]")
			metricsRaw = []byte("[]")
			status = "unmanaged"
		}
	}
	var instances, metrics any
	_ = json.Unmarshal(instancesRaw, &instances)
	_ = json.Unmarshal(metricsRaw, &metrics)
	item["management_status"], item["template_instances"], item["metrics"] = status, instances, metrics
	if upstreamID != nil {
		item["upstream_config_id"] = *upstreamID
	} else if id, ok := item["id"]; ok {
		item["upstream_config_id"] = id
	}
	return json.Marshal(item)
}

// refreshLoRaWANV2TemplateSemantics is deliberately called only by an explicit
// configuration reconcile. Editing a template never mutates existing devices.
func (s *Service) refreshLoRaWANV2TemplateSemantics(ctx context.Context, deviceID uuid.UUID) error {
	rows, err := s.db.Query(ctx, `SELECT DISTINCT ON (node_index) id,template_instances FROM lorawan_v2_node_config_snapshots WHERE device_id=$1 AND jsonb_array_length(template_instances)>0 ORDER BY node_index,created_at DESC`, deviceID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list lorawan_v2 template snapshots", err)
	}
	type update struct {
		id      uuid.UUID
		metrics []loraWANV2MetricSemantic
	}
	type snapshot struct {
		id        uuid.UUID
		instances []map[string]any
	}
	snapshots := []snapshot{}
	updates := []update{}
	for rows.Next() {
		var id uuid.UUID
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan lorawan_v2 template snapshot", err)
		}
		var instances []map[string]any
		if json.Unmarshal(raw, &instances) != nil {
			continue
		}
		snapshots = append(snapshots, snapshot{id: id, instances: instances})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return apperr.Wrap(apperr.KindInternal, "read lorawan_v2 template snapshots", err)
	}
	rows.Close()
	for _, snapshot := range snapshots {
		metrics := []loraWANV2MetricSemantic{}
		valid := true
		for _, instance := range snapshot.instances {
			templateID := int64(numberValue(instance["template_id"]))
			template, loadErr := s.GetTHCPNSensorTemplate(ctx, templateID)
			if loadErr != nil || template.Variants["lorawan_v2"] == nil {
				valid = false
				break
			}
			for _, metric := range template.Metrics {
				metrics = append(metrics, loraWANV2MetricSemantic{Key: metric.Key, Name: metric.Name, Type: metric.Type, Unit: metric.Unit})
			}
		}
		if valid {
			updates = append(updates, update{id: snapshot.id, metrics: metrics})
		}
	}
	for _, item := range updates {
		raw, _ := json.Marshal(item.metrics)
		if _, err := s.db.Exec(ctx, `UPDATE lorawan_v2_node_config_snapshots SET metrics_json=$2 WHERE id=$1`, item.id, raw); err != nil {
			return apperr.Wrap(apperr.KindInternal, "refresh lorawan_v2 template snapshot", err)
		}
	}
	return nil
}

func (s *Service) matchLoRaWANV2TemplateSequence(ctx context.Context, content []any) ([]map[string]any, []loraWANV2MetricSemantic, bool) {
	rows, err := s.db.Query(ctx, `SELECT t.id,t.sensor_type,t.metrics,v.config FROM sensor_template_variants v JOIN sensor_templates t ON t.id=v.template_id WHERE v.source_family='lorawan_v2' AND v.status='active' AND t.status='active' ORDER BY t.id`)
	if err != nil {
		return nil, nil, false
	}
	defer rows.Close()
	type candidate struct {
		id         int64
		sensorType string
		content    []any
		metrics    []loraWANV2MetricSemantic
	}
	candidates := []candidate{}
	for rows.Next() {
		var c candidate
		var metricsRaw, configRaw []byte
		if rows.Scan(&c.id, &c.sensorType, &metricsRaw, &configRaw) != nil {
			continue
		}
		var config map[string]any
		_ = json.Unmarshal(configRaw, &config)
		c.content, _ = config["content"].([]any)
		var rawMetrics []map[string]any
		_ = json.Unmarshal(metricsRaw, &rawMetrics)
		for _, metric := range sensorMetricsFromMaps(rawMetrics) {
			c.metrics = append(c.metrics, loraWANV2MetricSemantic{Key: metric.Key, Name: metric.Name, Type: metric.Type, Unit: metric.Unit})
		}
		if len(c.content) > 0 {
			candidates = append(candidates, c)
		}
	}
	instances := []map[string]any{}
	metrics := []loraWANV2MetricSemantic{}
	for offset := 0; offset < len(content); {
		matched := -1
		for index, candidate := range candidates {
			if offset+len(candidate.content) <= len(content) && reflect.DeepEqual(content[offset:offset+len(candidate.content)], candidate.content) && (matched < 0 || len(candidate.content) > len(candidates[matched].content)) {
				matched = index
			}
		}
		if matched < 0 {
			return nil, nil, false
		}
		candidate := candidates[matched]
		instances = append(instances, map[string]any{"template_id": candidate.id, "sensor_type": candidate.sensorType, "content": candidate.content})
		metrics = append(metrics, candidate.metrics...)
		offset += len(candidate.content)
	}
	return instances, metrics, true
}
