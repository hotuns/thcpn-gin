package datasource

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/testdb"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestAdminCreateV2SensorTemplateReportsInvalidProtocol(t *testing.T) {
	for _, tc := range []struct {
		name         string
		content      []any
		messageParts []string
	}{
		{
			name: "duplicate protocol metric",
			content: []any{[]any{"485", []any{"0103", []any{
				[]any{"temp", "0,1,0,>2i", "℃"},
				[]any{"temp", "1,1,0,>2i", "℃"},
			}}}},
			messageParts: []string{"重复", "temp"},
		},
		{
			name:         "no recognizable protocol metric",
			content:      []any{[]any{"485", []any{"0103", []any{}}}},
			messageParts: []string{"指标"},
		},
		{
			name:         "malformed IIC protocol",
			content:      []any{[]any{"iic", []any{"SHT30", "0x44"}}},
			messageParts: []string{"IIC", "型号", "地址"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			metric := map[string]any{"key": "temp", "info": map[string]any{"name": "温度", "unit": "℃"}}
			payload := map[string]any{
				"sensor_type": "V1 copy validation", "port": "", "port_num": 0, "driver": "", "port_nums": []int{},
				"params": map[string]any{"contents": []any{metric}}, "metrics": []any{metric},
				"variants": map[string]any{"lorawan_v2": map[string]any{"content": tc.content}}, "status": "active",
			}
			body, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			// Invalid editor input must stop at validation, before storage or any source access.
			router := gin.New()
			router.Use(func(c *gin.Context) {
				auth.SetActorContext(c, auth.Actor{UserID: uuid.New(), IsSystemAdmin: true})
				c.Next()
			})
			router.POST("/api/v1/admin/sensor-templates", NewHandler(NewService(nil), nil).AdminCreateSensorTemplate)
			request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sensor-templates", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			var result httpx.ErrorEnvelope
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatalf("invalid error response: %v: %s", err, response.Body)
			}
			if response.Code != http.StatusBadRequest || result.Error.Code != "INVALID_ARGUMENT" {
				t.Fatalf("invalid copied protocol must return actionable HTTP 400 INVALID_ARGUMENT; got HTTP %d %s", response.Code, response.Body)
			}
			if strings.TrimSpace(result.Error.Message) == "" || result.Error.Message == "service temporarily unavailable" {
				t.Fatalf("validation error must describe the protocol issue: %s", response.Body)
			}
			for _, part := range tc.messageParts {
				if !strings.Contains(result.Error.Message, part) {
					t.Errorf("validation message must identify %q: %s", part, response.Body)
				}
			}
		})
	}
}

func TestAdminCopyS2431SDITemplatePreservesExistingVersions(t *testing.T) {
	db := testdb.Open(t, 0)
	admin := testdb.Admin(t, db)
	service := NewService(db)
	const sensorType = "S2-431红光传感器"
	const unit = "μmol·m⁻²·s⁻¹"
	metrics := []map[string]any{
		{"key": "RPFD", "decode": "0", "info": map[string]any{"name": "红光光子通量密度", "unit": unit, "type": "wfv", "min": 0, "max": 3000, "index": 0}},
		{"key": "FRPFD", "decode": "1", "info": map[string]any{"name": "远红光光子通量密度", "unit": unit, "type": "sct", "min": 0, "max": 3000, "index": 1}},
	}
	content := func(address string) []any {
		return []any{[]any{"sdi", []any{address, []any{[]any{"RPFD", "0"}, []any{"FRPFD", "1"}}}}}
	}
	v1Params := map[string]any{"command": "1", "wait_time": 30, "contents": metrics}
	create := func(input platform.SensorTemplateWriteInput) platform.SensorTemplate {
		t.Helper()
		input.SensorType, input.Status, input.ActorID = sensorType, "active", admin
		result, err := service.CreateSensorTemplate(t.Context(), input)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	v1 := create(platform.SensorTemplateWriteInput{
		Port: "sdi", PortNum: 0, PortNums: []int{0, 1, 2, 3}, Driver: "sdi12", Params: v1Params, Metrics: metrics,
		Variants: map[string]map[string]any{"thcpn": {"port": "sdi", "port_num": 0, "port_nums": []int{0, 1, 2, 3}, "driver": "sdi12", "params": v1Params}},
	})
	existingV2 := create(platform.SensorTemplateWriteInput{
		PortNums: []int{}, Params: map[string]any{"contents": metrics}, Metrics: metrics,
		Variants: map[string]map[string]any{"lorawan_v2": {"content": content("0")}},
	})
	snapshot := func(id int64) []byte {
		t.Helper()
		var raw []byte
		if err := db.QueryRow(t.Context(), `SELECT jsonb_build_object('template',to_jsonb(t),
 'variants',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.source_family) FROM sensor_template_variants v WHERE v.template_id=t.id))
 FROM sensor_templates t WHERE id=$1`, id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	v1Before, v2Before := snapshot(v1.ID), snapshot(existingV2.ID)
	copiedMetrics := make([]map[string]any, len(metrics))
	for i, metric := range metrics {
		copiedMetrics[i] = map[string]any{"key": metric["key"], "info": metric["info"]}
	}
	input := map[string]any{
		"sensor_type": sensorType, "port": "", "port_num": 0, "port_nums": []int{}, "driver": "",
		"params": map[string]any{"contents": copiedMetrics}, "metrics": copiedMetrics, "status": "active",
		"variants": map[string]any{"lorawan_v2": map[string]any{"content": content("1")}},
	}
	body, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		auth.SetActorContext(c, auth.Actor{UserID: admin, IsSystemAdmin: true})
		c.Next()
	})
	router.POST("/api/v1/admin/sensor-templates", NewHandler(service, nil).AdminCreateSensorTemplate)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sensor-templates", bytes.NewReader(body)).WithContext(t.Context())
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("SDI copy failed: HTTP %d %s", response.Code, response.Body)
	}
	var created platform.SensorTemplate
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID <= 0 || created.ID == v1.ID || created.ID == existingV2.ID || len(created.Variants) != 1 {
		t.Fatalf("copy did not create an independent V2 template: id=%d variants=%v", created.ID, created.Variants)
	}
	protocol, err := json.Marshal(created.Variants[platform.SourceFamilyLoRaWANV2]["content"])
	if err != nil {
		t.Fatal(err)
	}
	wantProtocol, _ := json.Marshal(content("1"))
	if !bytes.Equal(protocol, wantProtocol) {
		t.Fatalf("SDI address or decode indexes changed: got %s, want %s", protocol, wantProtocol)
	}
	if len(created.Metrics) != len(metrics) {
		t.Fatalf("copy lost metrics: got %d, want %d", len(created.Metrics), len(metrics))
	}
	for i, metric := range created.Metrics {
		got, _ := json.Marshal(metric.Raw)
		want, _ := json.Marshal(copiedMetrics[i])
		info := metrics[i]["info"].(map[string]any)
		if !bytes.Equal(got, want) || metric.Unit != unit || metric.Key != metrics[i]["key"] || metric.Name != info["name"] || metric.Type != info["type"] {
			t.Errorf("metric %d lost its key, name, type, range, index or unit: %s", i, got)
		}
	}
	if !bytes.Equal(snapshot(v1.ID), v1Before) || !bytes.Equal(snapshot(existingV2.ID), v2Before) {
		t.Fatal("copy modified the source V1 template or existing address-0 V2 template")
	}
	var count int
	if err := db.QueryRow(t.Context(), "SELECT count(*) FROM sensor_templates WHERE sensor_type=$1", sensorType).Scan(&count); err != nil || count != 3 {
		t.Fatalf("expected source V1, existing V2 and independent copied V2; count=%d: %v", count, err)
	}
}
