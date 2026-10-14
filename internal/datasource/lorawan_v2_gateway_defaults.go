package datasource

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
)

func generatedLoRaWANV2SN(source, actor, request uuid.UUID) string {
	sum := sha256.Sum256([]byte(source.String() + "/" + actor.String() + "/" + request.String()))
	return strings.ToUpper(hex.EncodeToString(sum[:10]))
}

func defaultLoRaWANV2GatewayConfig(sn string) map[string]any {
	raw := `{
 "system":{"did":"{device_sn}","log_print_lvl":"all","log_file_lvl":"all"},
 "wdt":{"enable":0,"timeout":60,"feed":30},
 "device":{"clean_session":1,"chunk_size":64,"lora_chunk_snr":1000,"lora_chunk_rssi":1000,"error_max":2},
 "platform":{
   "enable":1,"input":"sql",
   "protocol":{"type":"mqtt","host":"mqtt-cn-tl32t5x6o0f.mqtt.aliyuncs.com","port":1883,
     "credentials_url":"http://8.131.103.198:8181/device/{device_sn}/mqtt_credentials",
     "cfg_topic":"ynse/lorawan/v2/device/{device_sn}/config/downlink",
     "data_topic":"ynse/lorawan/v2/device/{device_sn}/data/uplink",
     "info_topic":"ynse/lorawan/v2/device/{device_sn}/info/uplink"},
   "info_sec":43200,"timesync_sec":43200,"firmware_sec":600,"battery_sec":600,"battery_did":255,
   "ext_info_conf":{"enable":1},"logfile_enable":1,"logfile_sec":86400,
   "logfile_upload_url":"http://8.131.103.198:8181/device/{device_sn}/log",
   "settings_sec":300,"settings_url":"http://8.131.103.198:8181/device/{device_sn}/config"
 },
 "ota":{"host":"8.131.103.198","port":8181,"period":300}
}`
	var content map[string]any
	_ = json.Unmarshal([]byte(raw), &content)
	// URL/topic placeholders are expanded by firmware using system.did.
	content["system"].(map[string]any)["did"] = sn
	return content
}

func loRaWANV2ConfigurationCount(raw json.RawMessage) (int, bool) {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return 0, false
	}
	for {
		switch item := value.(type) {
		case []any:
			return len(item), true
		case map[string]any:
			found := false
			for _, key := range []string{"payload", "data", "items"} {
				if nested, ok := item[key]; ok {
					value = nested
					found = true
					break
				}
			}
			if !found {
				return 0, false
			}
		default:
			return 0, false
		}
	}
}
