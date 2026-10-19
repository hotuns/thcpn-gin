package platform

import "encoding/json"

func SummarizeConfigChange(previousID int64, previousData, previousImage, previousControl, dataJSON, imageJSON, controlJSON json.RawMessage) ConfigAudit {
	result := ConfigAudit{PreviousConfigID: previousID}
	if !JsonSemanticallyEqual(previousData, dataJSON) {
		result.ChangedSections = append(result.ChangedSections, "data_json")
	}
	if !JsonSemanticallyEqual(previousImage, imageJSON) {
		result.ChangedSections = append(result.ChangedSections, "image_json")
	}
	if !JsonSemanticallyEqual(previousControl, controlJSON) {
		result.ChangedSections = append(result.ChangedSections, "control_json")
	}
	var sensors []map[string]any
	if json.Unmarshal(dataJSON, &sensors) == nil {
		result.SensorCount = len(sensors)
		for _, sensor := range sensors {
			params, _ := sensor["params"].(map[string]any)
			contents, _ := params["contents"].([]any)
			result.MetricCount += len(contents)
		}
	}
	var images []any
	if json.Unmarshal(imageJSON, &images) == nil {
		result.ImageCount = len(images)
	}
	return result
}
