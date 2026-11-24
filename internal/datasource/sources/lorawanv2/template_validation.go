package lorawanv2

import (
	"strings"
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
		// This parser also reads upstream configs; here the content is editor input.
		message := "V2 协议项格式不正确，请检查协议结构和指标定义"
		reason := apperr.MessageOf(err)
		switch {
		case strings.HasPrefix(reason, "duplicate lorawan_v2 metric: "):
			message = "V2 协议项中存在重复的指标键：" + strings.TrimPrefix(reason, "duplicate lorawan_v2 metric: ") + "，请为每个指标设置唯一的键"
		case strings.HasPrefix(reason, "invalid lorawan_v2 IIC"):
			message = "V2 IIC 协议项格式不正确，请检查型号、地址和指标键列表"
		case reason == "unrecognized lorawan_v2 sensor configuration":
			message = "V2 协议项中没有可识别的指标，请检查指标键、解析规则和单位"
		}
		return apperr.Wrap(apperr.KindInvalidArgument, message, err)
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
