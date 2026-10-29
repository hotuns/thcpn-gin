package lorawanv2

import (
	"encoding/json"
	"strings"
	"testing"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/objectstore"
)

func TestResolveLogURLs(t *testing.T) {
	signer := objectstore.NewSigner(config.ObjectStoreConfig{Provider: "oss", Endpoint: "https://oss-cn-beijing.aliyuncs.com", Bucket: "lora-logs", PublicURLPrefix: "https://lora-logs.oss-cn-beijing.aliyuncs.com"}, "test")
	for _, envelope := range []bool{false, true} {
		payload := `{"data":[{"file":"lorawan/v2/device/2026/log.txt"},{"file":"../secret"},{"file":"https://foreign.example/log.txt"},{"file":"javascript:alert(1)"}],"pagination":{"total":4}}`
		if envelope {
			payload = `{"success":true,"payload":` + payload + `}`
		}
		result, err := ResolveLogURLs(json.RawMessage(payload), signer)
		if err != nil {
			t.Fatal(err)
		}
		var root map[string]json.RawMessage
		if err := json.Unmarshal(result, &root); err != nil {
			t.Fatal(err)
		}
		if envelope {
			if err := json.Unmarshal(root["payload"], &root); err != nil {
				t.Fatal(err)
			}
		}
		var rows []map[string]any
		if err := json.Unmarshal(root["data"], &rows); err != nil {
			t.Fatal(err)
		}
		if rows[0]["file"] != "lorawan/v2/device/2026/log.txt" || rows[0]["file_url"] != "https://lora-logs.oss-cn-beijing.aliyuncs.com/lorawan/v2/device/2026/log.txt" {
			t.Fatalf("object key used as navigation URL: %s", result)
		}
		for _, row := range rows[1:] {
			if row["file_url"] != nil || row["file_url_error"] == nil {
				t.Fatalf("invalid key exposed: %v", row)
			}
		}
		if !strings.Contains(string(result), `"total":4`) {
			t.Fatal("pagination lost")
		}
	}
}
func TestResolveLogURLsWithoutStorage(t *testing.T) {
	result, err := ResolveLogURLs(json.RawMessage(`{"data":[{"file":"lorawan/v2/log.txt","file_url":"https://untrusted.example"}]}`), nil)
	if err != nil || strings.Contains(string(result), `"file_url":`) {
		t.Fatalf("must not navigate without a resolved URL: %s %v", result, err)
	}
	if _, err := ResolveLogURLs(json.RawMessage(`{"data":"bad"}`), nil); err == nil {
		t.Fatal("malformed source accepted")
	}
}
