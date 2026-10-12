package datasource

import (
	"encoding/json"
	"github.com/google/uuid"
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
