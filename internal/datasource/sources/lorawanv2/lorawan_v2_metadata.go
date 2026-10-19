package lorawanv2

import (
	"encoding/json"
	"thcpn-gin/internal/apperr"
)

func NormalizeLoRaWANV2GatewayConfig(body any, sn string) (map[string]any, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	var config map[string]any
	if json.Unmarshal(raw, &config) != nil || config == nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "gateway configuration must be an object")
	}
	if nested, ok := config["content"].(map[string]any); ok && len(config) == 1 {
		config = nested
	}
	if system, ok := config["system"].(map[string]any); ok {
		if did, exists := system["did"]; exists && did != sn {
			return nil, apperr.New(apperr.KindInvalidArgument, "system.did must match gateway SN")
		}
		// Upstream assigns the configuration ID; older platform drafts include cid.
		delete(system, "cid")
	}
	return config, nil
}
