package lorawanv2

import (
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

func ValidateTemplate(config map[string]any, defined map[string]bool) error {
	content, ok := config["content"].([]any)
	if !ok || len(content) == 0 {
		return apperr.New(apperr.KindInvalidArgument, "lorawan_v2 variant content is required")
	}
	units, err := parseLoRaWANV2MetricUnits(platform.MustJSON(map[string]any{"content": content}))
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
	return nil
}
