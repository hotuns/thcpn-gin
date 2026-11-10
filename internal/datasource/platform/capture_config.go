package platform

import (
	"bytes"
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
	"thcpn-gin/internal/apperr"
)

type CaptureConfig struct {
	Version    int64         `json:"version"`
	Sensors    []CaptureItem `json:"sensors"`
	Cameras    []CaptureItem `json:"cameras"`
	HasCameras bool          `json:"has_cameras"`
}

type CaptureItem struct {
	ID      string          `json:"id"`
	Label   string          `json:"label"`
	Fields  []CaptureField  `json:"fields"`
	Metrics []CaptureMetric `json:"metrics,omitempty"`
}

type CaptureMetric struct {
	Number int            `json:"number"`
	Label  string         `json:"label"`
	Fields []CaptureField `json:"fields"`
}

type CaptureField struct {
	Key   string `json:"key"`
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type CaptureConfigChange struct {
	Section string            `json:"section"`
	ItemID  string            `json:"item_id"`
	Metric  int               `json:"metric,omitempty"`
	Fields  map[string]string `json:"fields"`
}

// The adapter owns this allowlist. Native paths and unlisted values never go to the workspace client.
type CaptureFieldRule struct{ Key, Path, Kind string }

type CaptureConfigSpec struct {
	Sensors, Metrics, Cameras    []CaptureFieldRule
	LegacySensors, LegacyCameras []CaptureFieldRule
}

func NormalizeDeviceConfigInput(input UpdateDeviceConfigInput, legacyCapture bool) (data, image, control json.RawMessage, err error) {
	if input.CapturePatch {
		// A projected patch already has native JSON. Keep unedited values and their numeric types intact.
		data, image = bytes.TrimSpace(input.DataJSON), bytes.TrimSpace(input.ImageJSON)
		if len(data) > 0 && (!json.Valid(data) || data[0] != '[' && !(legacyCapture && data[0] == '{')) {
			return nil, nil, nil, apperr.New(apperr.KindInvalidArgument, "invalid data_json")
		}
		if len(image) > 0 && (!json.Valid(image) || image[0] != '[') {
			return nil, nil, nil, apperr.New(apperr.KindInvalidArgument, "invalid image_json")
		}
		return data, image, nil, nil
	}
	data, err = NormalizeConfigArrayJSON(input.DataJSON, "data_json")
	if err != nil {
		return nil, nil, nil, err
	}
	image, err = NormalizeConfigArrayJSON(input.ImageJSON, "image_json")
	if err != nil {
		return nil, nil, nil, err
	}
	control, err = NormalizeConfigObjectJSON(input.ControlJSON, "control_json")
	return data, image, control, err
}

func PreserveConfigSections(current DeviceConfig, data, image, control json.RawMessage) (json.RawMessage, json.RawMessage, json.RawMessage) {
	if data == nil {
		data = current.DataJSON
	}
	if image == nil {
		image = current.ImageJSON
	}
	if control == nil {
		control = current.ControlJSON
	}
	return data, image, control
}

type captureRecord struct {
	section, id, label string
	value              map[string]any
	fields             []CaptureFieldRule
	metrics            []any
	fromData           bool
}

func (spec CaptureConfigSpec) Project(config DeviceConfig) (CaptureConfig, error) {
	result := CaptureConfig{Version: config.ID, Sensors: []CaptureItem{}, Cameras: []CaptureItem{}, HasCameras: len(spec.Cameras) > 0}
	_, _, records, err := spec.read(config)
	if err != nil {
		return result, err
	}
	for _, record := range records {
		item := CaptureItem{ID: record.id, Label: record.label, Fields: captureFields(record.value, record.fields)}
		for index, raw := range record.metrics {
			if metric, ok := raw.(map[string]any); ok {
				item.Metrics = append(item.Metrics, CaptureMetric{Number: index + 1, Label: captureText(metric["key"]), Fields: captureFields(metric, spec.Metrics)})
			}
		}
		if record.section == "camera" {
			result.Cameras = append(result.Cameras, item)
		} else {
			result.Sensors = append(result.Sensors, item)
		}
	}
	return result, nil
}

// Patch returns only the changed sections; the source writer preserves everything else at the locked version.
func (spec CaptureConfigSpec) Patch(config DeviceConfig, changes []CaptureConfigChange) (dataJSON, imageJSON json.RawMessage, err error) {
	data, images, records, err := spec.read(config)
	if err != nil {
		return nil, nil, err
	}
	targets := make(map[[2]string]captureRecord, len(records))
	for _, record := range records {
		targets[[2]string{record.section, record.id}] = record
	}
	var changedData, changedImages bool
	for _, change := range changes {
		record, exists := targets[[2]string{change.Section, change.ItemID}]
		if !exists || change.Metric < 0 || change.Metric > len(record.metrics) || len(change.Fields) == 0 {
			return nil, nil, apperr.New(apperr.KindInvalidArgument, "找不到要修改的传感器、指标或相机通道")
		}
		fields, target := record.fields, record.value
		if change.Metric > 0 {
			fields = spec.Metrics
			target, _ = record.metrics[change.Metric-1].(map[string]any)
			if target == nil {
				return nil, nil, apperr.New(apperr.KindInvalidArgument, "该指标不支持编辑")
			}
		}
		for key, value := range change.Fields {
			if err := updateCaptureField(target, fields, key, value); err != nil {
				return nil, nil, err
			}
		}
		changedData = changedData || record.fromData
		changedImages = changedImages || !record.fromData
	}
	if changedData {
		dataJSON = MustJSON(data)
	}
	if changedImages {
		imageJSON = MustJSON(images)
	}
	return dataJSON, imageJSON, nil
}

func (spec CaptureConfigSpec) read(config DeviceConfig) (data, images any, records []captureRecord, err error) {
	decode := func(raw json.RawMessage, value *any) error {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if err := decoder.Decode(value); err != nil {
			return apperr.Wrap(apperr.KindDataSource, "读取采集配置失败", err)
		}
		return nil
	}
	if err := decode(config.DataJSON, &data); err != nil {
		return nil, nil, nil, err
	}
	if len(spec.Cameras) > 0 {
		if err := decode(config.ImageJSON, &images); err != nil {
			return nil, nil, nil, err
		}
	}
	if legacy, ok := data.(map[string]any); ok && len(spec.LegacySensors) > 0 {
		keys := make([]string, 0, len(legacy))
		for key := range legacy {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			entry, ok := legacy[key].(map[string]any)
			if !ok || entry == nil {
				continue
			}
			section, fields := "sensor", spec.LegacySensors
			if entry["type"] == "image" {
				section, fields = "camera", spec.LegacyCameras
			}
			records = append(records, captureRecord{section: section, id: "legacy:" + key, label: key, value: entry, fields: fields, fromData: true})
		}
	} else if entries, ok := data.([]any); ok {
		for index, raw := range entries {
			if entry, ok := raw.(map[string]any); ok && entry != nil {
				metrics, _ := captureValue(entry, "params.contents").([]any)
				label := FirstNonEmpty(captureText(entry["sensorType"]), captureText(entry["description"]))
				records = append(records, captureRecord{section: "sensor", id: strconv.Itoa(index + 1), label: label, value: entry, fields: spec.Sensors, metrics: metrics, fromData: true})
			}
		}
	} else if data != nil {
		return nil, nil, nil, apperr.New(apperr.KindDataSource, "该设备的传感器配置格式不受支持")
	}
	if entries, ok := images.([]any); ok {
		for index, raw := range entries {
			if entry, ok := raw.(map[string]any); ok && entry != nil {
				records = append(records, captureRecord{section: "camera", id: "channel:" + strconv.Itoa(index+1), label: captureText(entry["key"]), value: entry, fields: spec.Cameras})
			}
		}
	}
	return data, images, records, nil
}

func captureText(value any) string {
	text, _ := value.(string)
	return text
}

func captureValue(object map[string]any, path string) any {
	for {
		part, rest, nested := strings.Cut(path, ".")
		if !nested {
			return object[part]
		}
		object, _ = object[part].(map[string]any)
		path = rest
	}
}

func captureFields(object map[string]any, rules []CaptureFieldRule) []CaptureField {
	fields := make([]CaptureField, 0, len(rules))
	for _, rule := range rules {
		var text string
		switch value := captureValue(object, rule.Path).(type) {
		case nil:
		case string:
			text = value
		case json.Number:
			text = string(value)
		default:
			continue
		}
		fields = append(fields, CaptureField{Key: rule.Key, Kind: rule.Kind, Value: text})
	}
	return fields
}

func updateCaptureField(object map[string]any, rules []CaptureFieldRule, key, input string) error {
	for _, rule := range rules {
		if rule.Key != key {
			continue
		}
		if len(input) > 4096 {
			return apperr.New(apperr.KindInvalidArgument, "配置字段过长："+key)
		}
		var value any = input
		existing := captureValue(object, rule.Path)
		if rule.Kind != "text" {
			number := strings.TrimSpace(input)
			if rule.Kind == "integer" {
				parsed, err := strconv.ParseInt(number, 10, 32)
				if err != nil || parsed < 0 {
					return apperr.New(apperr.KindInvalidArgument, "配置字段必须是非负整数："+key)
				}
				value = parsed
			} else {
				parsed, err := strconv.ParseFloat(number, 64)
				if err != nil || math.IsInf(parsed, 0) || math.IsNaN(parsed) {
					return apperr.New(apperr.KindInvalidArgument, "配置字段必须是数字："+key)
				}
				value = parsed
			}
			if _, legacyString := existing.(string); legacyString {
				value = number
			}
		}
		for path := rule.Path; ; {
			part, rest, nested := strings.Cut(path, ".")
			if !nested {
				switch object[part].(type) {
				case nil, string, json.Number, int64, float64:
					object[part] = value
					return nil
				default:
					return apperr.New(apperr.KindInvalidArgument, "该字段的原有格式不支持编辑："+key)
				}
			}
			if object[part] == nil {
				object[part] = map[string]any{}
			}
			var ok bool
			object, ok = object[part].(map[string]any)
			if !ok {
				return apperr.New(apperr.KindInvalidArgument, "该字段的原有格式不支持编辑："+key)
			}
			path = rest
		}
	}
	return apperr.New(apperr.KindInvalidArgument, "该字段不允许通过用户端修改："+key)
}
