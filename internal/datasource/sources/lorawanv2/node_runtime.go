package lorawanv2

import (
	"bytes"
	"encoding/json"
	"math"
	platform "thcpn-gin/internal/datasource/platform"
)

func ParseNodeRuntime(key string, row map[string]json.RawMessage) platform.NodeRuntime {
	result := platform.NodeRuntime{Key: key}
	if ts, err := loraWANV2Timestamp(row["ts"]); err == nil {
		result.SampledAt = &ts
	}
	for key, target := range map[string]**float64{"battery": &result.Battery, "rssi": &result.RSSI, "snr": &result.SNR} {
		raw := bytes.TrimSpace(row[key])
		if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
			continue
		}
		if value, ok := loraWANV2Number(raw); ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
			*target = &value
		}
	}
	return result
}
