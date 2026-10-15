package datasource

import (
	"encoding/json"
	"github.com/google/uuid"
	"reflect"
	"strings"
	"testing"
)

func TestGeneratedGatewaySNAndDefaultConfiguration(t *testing.T) {
	source, actor, key := uuid.New(), uuid.New(), uuid.New()
	sn := generatedLoRaWANV2SN(source, actor, key)
	if len(sn) != 20 || sn != generatedLoRaWANV2SN(source, actor, key) || sn == generatedLoRaWANV2SN(source, actor, uuid.New()) {
		t.Fatal("SN must be unique per request and stable on retry")
	}
	content := defaultLoRaWANV2GatewayConfig(sn)
	raw, err := json.Marshal(content)
	if err != nil || !strings.Contains(string(raw), "{device_sn}") {
		t.Fatal("firmware placeholders must be preserved")
	}
	if content["system"].(map[string]any)["did"] != sn {
		t.Fatal("wrong did")
	}
	protocol := content["platform"].(map[string]any)["protocol"].(map[string]any)
	for _, key := range []string{"credentials_url", "cfg_topic", "data_topic", "info_topic"} {
		if !strings.Contains(protocol[key].(string), "{device_sn}") || strings.Contains(protocol[key].(string), sn) {
			t.Fatalf("firmware placeholder replaced in %s", key)
		}
	}
	platform := content["platform"].(map[string]any)
	for _, key := range []string{"logfile_upload_url", "settings_url"} {
		if !strings.Contains(platform[key].(string), "{device_sn}") || strings.Contains(platform[key].(string), sn) {
			t.Fatalf("firmware placeholder replaced in %s", key)
		}
	}
	if protocol["port"] != float64(1883) {
		t.Fatal("wrong MQTT port")
	}
}

func TestDefaultGatewayConfigurationMatchesRequiredTemplate(t *testing.T) {
	const expectedJSON = `{
 "system":{"did":"TEST-SN","cid":1,"log_print_lvl":"all","log_file_lvl":"all"},
 "wdt":{"enable":0,"timeout":60,"feed":30},
 "device":{"clean_session":1,"chunk_size":64,"lora_chunk_snr":1000,"lora_chunk_rssi":1000,"error_max":2},
 "platform":{"enable":1,"input":"sql","protocol":{"type":"mqtt","host":"mqtt-cn-tl32t5x6o0f.mqtt.aliyuncs.com","port":1883,
 "credentials_url":"http://8.131.103.198:8181/device/{device_sn}/mqtt_credentials",
 "cfg_topic":"ynse/lorawan/v2/device/{device_sn}/config/downlink",
 "data_topic":"ynse/lorawan/v2/device/{device_sn}/data/uplink",
 "info_topic":"ynse/lorawan/v2/device/{device_sn}/info/uplink"},
 "info_sec":43200,"timesync_sec":43200,"firmware_sec":600,"battery_sec":600,"battery_did":255,"ext_info_conf":{"enable":1},
 "logfile_enable":1,"logfile_sec":86400,"logfile_upload_url":"http://8.131.103.198:8181/device/{device_sn}/log",
 "settings_sec":300,"settings_url":"http://8.131.103.198:8181/device/{device_sn}/config"},
 "ota":{"host":"8.131.103.198","port":8181,"period":300}}
 `
	var expected map[string]any
	if err := json.Unmarshal([]byte(expectedJSON), &expected); err != nil {
		t.Fatal(err)
	}
	if actual := defaultLoRaWANV2GatewayConfig("TEST-SN"); !reflect.DeepEqual(actual, expected) {
		t.Fatal("default gateway configuration does not match required template")
	}
}
