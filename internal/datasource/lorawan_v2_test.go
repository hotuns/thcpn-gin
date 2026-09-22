package datasource

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/testdb"
)

func TestCompileLoRaWANV2TemplatesSupportsAllSensorKinds(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	service := NewService(db)
	templates := []struct {
		name, key string
		content   []any
	}{
		{"模拟量", "adc1", []any{[]any{"ad", []any{[]any{"adc1", "1,0", "V"}}, float64(1)}}},
		{"温度", "temp", []any{[]any{"485", []any{"0103", []any{[]any{"temp", "0,0.1,0,>2i", "℃"}}}}}},
		{"土壤水分", "SM", []any{[]any{"sdi", []any{"0", []any{[]any{"SM", "0"}}}}}},
		{"空气湿度", "humidity", []any{[]any{"iic", []any{"SHT30", "0x44", []any{"humidity"}}}}},
	}
	instances := []any{}
	for _, fixture := range templates {
		metric := map[string]any{"key": fixture.key, "info": map[string]any{"name": fixture.name, "unit": ""}}
		created, err := service.CreateTHCPNSensorTemplate(ctx, THCPNSensorTemplateWriteInput{SensorType: fixture.name, Params: map[string]any{"contents": []any{metric}}, Metrics: []map[string]any{metric}, Variants: map[string]map[string]any{"lorawan_v2": {"wait_time": float64(5), "content": fixture.content}}, Status: "active", ActorID: admin})
		if err != nil {
			t.Fatal(err)
		}
		instances = append(instances, map[string]any{"template_id": float64(created.ID)})
	}
	compiled, err := service.compileLoRaWANV2NodeConfig(ctx, map[string]any{"mode": "templates", "template_instances": instances})
	if err != nil {
		t.Fatal(err)
	}
	if len(compiled.Content) != 4 || len(compiled.Metrics) != 4 || compiled.WaitTime != 5 {
		t.Fatalf("unexpected compiled config: %#v", compiled)
	}
}

func TestValidateLoRaWANV2ResourcesRejectsConflicts(t *testing.T) {
	content := []any{[]any{"ad", []any{[]any{"a", "1,0", "V"}}, float64(1)}, []any{"ad", []any{[]any{"b", "1,0", "V"}}, float64(1)}}
	if err := validateLoRaWANV2Resources(content); err == nil {
		t.Fatal("duplicate AD port accepted")
	}
}

func TestCompileLoRaWANV2AdvancedRequiresEveryMetricName(t *testing.T) {
	service := &Service{}
	content := []any{[]any{"iic", []any{"SHT30", "0x44", []any{"humidity"}}}}
	_, err := service.compileLoRaWANV2NodeConfig(t.Context(), map[string]any{
		"mode": "advanced", "content": content,
		"metrics": []any{map[string]any{"key": "humidity", "name": ""}},
	})
	if err == nil {
		t.Fatal("advanced config accepted a metric without a Chinese display name")
	}
}

func TestCompileLoRaWANV2TemplateWaitTimeCanBeOverridden(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	service := NewService(db)
	metric := map[string]any{"key": "temp", "info": map[string]any{"name": "温度", "unit": "℃"}}
	template, err := service.CreateTHCPNSensorTemplate(ctx, THCPNSensorTemplateWriteInput{
		SensorType: "温度", Params: map[string]any{"contents": []any{metric}}, Metrics: []map[string]any{metric},
		Variants: map[string]map[string]any{"lorawan_v2": {"wait_time": float64(60), "content": []any{[]any{"iic", []any{"SHT30", "0x44", []any{"temp"}}}}}}, Status: "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := service.compileLoRaWANV2NodeConfig(ctx, map[string]any{
		"mode": "templates", "wait_time": float64(10),
		"template_instances": []any{map[string]any{"template_id": float64(template.ID)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if compiled.WaitTime != 10 {
		t.Fatalf("manual wait_time override ignored: %d", compiled.WaitTime)
	}
}

func TestLoRaWANV2ClientUsesBasicAuthForEveryOperation(t *testing.T) {
	operations := []struct{ method, path string }{
		{http.MethodGet, "/ping"}, {http.MethodGet, "/devices"}, {http.MethodPost, "/device"}, {http.MethodGet, "/device/GW-1"},
		{http.MethodPost, "/device/GW-1/firmware"}, {http.MethodGet, "/firmwares"}, {http.MethodGet, "/firmware/1"}, {http.MethodDelete, "/firmware/1"},
		{http.MethodPost, "/device/GW-1/config"}, {http.MethodGet, "/device/GW-1/configs"}, {http.MethodGet, "/device/GW-1/config/1"},
		{http.MethodPost, "/device/GW-1/node/1/sensor_config"}, {http.MethodGet, "/device/GW-1/node/1/sensor_config/latest"}, {http.MethodGet, "/device/GW-1/node/1/sensor_config/1"}, {http.MethodGet, "/device/GW-1/node/1/sensor_configs"},
		{http.MethodPost, "/device/GW-1/node/1/time_config"}, {http.MethodGet, "/device/GW-1/logs"}, {http.MethodGet, "/device/GW-1/node/1/data"}, {http.MethodGet, "/device/GW-1/infos"},
	}
	seen := map[string]bool{}
	var lock sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "reader" || password != "secret" {
			t.Errorf("missing basic auth for %s %s", r.Method, r.URL.Path)
		}
		lock.Lock()
		seen[r.Method+" "+r.URL.Path] = true
		lock.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"error_code":"0x00000000","error_message":"OK","payload":{}}`))
	}))
	defer server.Close()
	client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api", DsnSecretRef: "secret:lora"})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	for _, operation := range operations {
		var body any
		if operation.method == http.MethodPost {
			body = map[string]any{"value": true}
		}
		if _, err := client.request(context.Background(), operation.method, operation.path, url.Values{}, body); err != nil {
			t.Fatalf("%s %s: %v", operation.method, operation.path, err)
		}
	}
	for _, operation := range operations {
		if !seen[operation.method+" "+operation.path] {
			t.Errorf("operation not requested: %s %s", operation.method, operation.path)
		}
	}
}

func TestLoRaWANV2TelemetrySupportsSourceTimestampForms(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/device/GW-1/node/1/data" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.URL.Query().Get("page_size") != "50" || r.URL.Query().Get("start_at") == "" || r.URL.Query().Get("end_at") == "" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"success":true,"payload":{"pagination":{"current_page":1,"page_size":50,"total_page":1,"total_count":3},"data":[{"ts":1760000000,"temp":20.5},{"ts":"2026-01-01T00:00:00Z","temp":21.5},{"ts":{"$date":{"$numberLong":"1760000000000"}},"temp":22.5}]}}`))
	}))
	defer server.Close()
	runtime := NewRuntime(staticResolver(`{"base_url":"` + server.URL + `","username":"reader","password":"secret"}`))
	result, err := runtime.QueryTelemetry(context.Background(), DataSource{ID: uuid.New(), Type: "http_api", DsnSecretRef: "secret:lora", Status: "active"}, TelemetryQuery{
		Binding: DataStreamBinding{ID: uuid.New(), DataStreamID: uuid.New(), DataSourceID: uuid.New(), AdapterCode: AdapterLoRaWANV2, PayloadType: "json", AdapterConfigJSON: json.RawMessage(`{"gateway_sn":"GW-1","node_index":1,"metric":"temp"}`), Status: "active"},
		Start:   time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), End: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), Limit: 10,
	})
	if err != nil {
		t.Fatalf("query telemetry: %v", err)
	}
	if len(result.Points) != 3 || !result.Complete {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Points[0].Timestamp.After(result.Points[1].Timestamp) || result.Points[1].Timestamp.After(result.Points[2].Timestamp) {
		t.Fatalf("points are not sorted: %#v", result.Points)
	}
}

func TestLoRaWANV2NodeMetricUnits(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"payload":{"content":[["485",["request",[["temp","rule","℃"],["humi","rule","RH%"]]]]]}}`))
	}))
	defer server.Close()
	client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api", DsnSecretRef: "secret:lora"})
	if err != nil {
		t.Fatal(err)
	}
	units, err := loraWANV2NodeMetricUnits(context.Background(), client, "GW-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if units["temp"] != "℃" || units["humi"] != "RH%" {
		t.Fatalf("unexpected units: %#v", units)
	}
}

func TestLoRaWANV2TelemetryBatchReadsEachNodeOnce(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		_, _ = w.Write([]byte(`{"success":true,"payload":{"pagination":{"current_page":1,"page_size":50,"total_page":1,"total_count":1},"data":[{"ts":1760000000,"temp":20.5,"humi":55.5}]}}`))
	}))
	defer server.Close()
	runtime := NewRuntime(staticResolver(`{"base_url":"` + server.URL + `","username":"reader","password":"secret"}`))
	makeBinding := func(metric string) DataStreamBinding {
		return DataStreamBinding{ID: uuid.New(), DataStreamID: uuid.New(), DataSourceID: uuid.New(), AdapterCode: AdapterLoRaWANV2, PayloadType: "json", AdapterConfigJSON: json.RawMessage(`{"gateway_sn":"GW-1","node_index":1,"metric":"` + metric + `"}`), Status: "active"}
	}
	first, second := makeBinding("temp"), makeBinding("humi")
	batch, err := runtime.QueryTelemetryBatch(context.Background(), DataSource{ID: uuid.New(), Type: "http_api", DsnSecretRef: "secret:lora", Status: "active"}, TelemetryBatchQuery{Bindings: []DataStreamBinding{first, second}, Start: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), End: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), Limit: 10})
	if err != nil {
		t.Fatalf("query batch: %v", err)
	}
	if requests != 1 || batch.SourceScans != 1 {
		t.Fatalf("expected one source read, got requests=%d scans=%d", requests, batch.SourceScans)
	}
	if batch.Series[first.DataStreamID].Points[0].Value != 20.5 || batch.Series[second.DataStreamID].Points[0].Value != 55.5 {
		t.Fatalf("unexpected batch series: %#v", batch.Series)
	}
}

func TestLoRaWANV2NodeDiagnosticMetricsAreQueryable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/device/898604B41025D0133283/node/4/data" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"success":true,"payload":{"pagination":{"current_page":1,"page_size":50,"total_page":1,"total_count":1},"data":[{"ts":1790062294,"meta":{"gateway_sn":"898604B41025D0133283","node_config_id":31,"node_index":4},"snr":13.0,"created_at":1790062342,"VHI":-1.3,"rssi":-55.0,"sd_card_rate":0.03,"battery":3.596,"SFT":-0.115,"VHO":0.16}]}}`))
	}))
	defer server.Close()

	client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api", DsnSecretRef: "secret:lora"})
	if err != nil {
		t.Fatal(err)
	}
	nodeIndex := 4
	series, rows, err := queryLoRaWANV2Metrics(context.Background(), client, loraWANV2TelemetryConfig{GatewaySN: "898604B41025D0133283", NodeIndex: &nodeIndex}, []string{"battery", "rssi", "snr", "sd_card_rate"}, time.Unix(1790062200, 0), time.Unix(1790062400, 0), 10, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	if rows != 1 || series["battery"].Points[0].Value != 3.596 || series["rssi"].Points[0].Value != -55 || series["snr"].Points[0].Value != 13 || series["sd_card_rate"].Points[0].Value != 3 {
		t.Fatalf("unexpected diagnostics: rows=%d series=%#v", rows, series)
	}
}

func TestLoRaWANV2RecordPaginationUsesTheUpstreamLimit(t *testing.T) {
	pages := []int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pages = append(pages, page)
		count := 50
		if page == 2 {
			count = 25
		}
		data := make([]map[string]any, count)
		for i := range data {
			data[i] = map[string]any{"ts": 1760000000 + i + (page-1)*50, "temp": 20}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": map[string]any{"pagination": map[string]any{"current_page": page, "page_size": 50, "total_page": 2, "total_count": 75}, "data": data}})
	}))
	defer server.Close()
	client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api", DsnSecretRef: "secret:lora"})
	if err != nil {
		t.Fatal(err)
	}
	records, complete, err := client.listRecords(context.Background(), loraWANV2TelemetryConfig{GatewaySN: "GW-1"}, time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), 75)
	if err != nil {
		t.Fatalf("list records: %v", err)
	}
	if len(records) != 75 || !complete || len(pages) != 2 || pages[0] != 1 || pages[1] != 2 {
		t.Fatalf("unexpected pagination: records=%d complete=%t pages=%v", len(records), complete, pages)
	}
}

func TestLoRaWANV2RecordPaginationSkipsEmptyIntermediatePage(t *testing.T) {
	pages := []int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pages = append(pages, page)
		data := []map[string]any{}
		if page != 2 {
			data = []map[string]any{{"ts": 1760000000 + page, "temp": page}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": map[string]any{"pagination": map[string]any{"current_page": page, "page_size": 50, "total_page": 3, "total_count": 3}, "data": data}})
	}))
	defer server.Close()
	client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api"})
	if err != nil {
		t.Fatal(err)
	}
	records, complete, err := client.listRecords(context.Background(), loraWANV2TelemetryConfig{GatewaySN: "GW"}, time.Unix(1750000000, 0), time.Unix(1770000000, 0), 10)
	if err != nil || !complete || len(records) != 2 || fmt.Sprint(pages) != "[1 2 3]" {
		t.Fatalf("records=%d complete=%t pages=%v err=%v", len(records), complete, pages, err)
	}
}

func TestLoRaWANV2TruncatedPageIsIncomplete(t *testing.T) {
	for _, limit := range []int{1, 10, 29, 30} {
		t.Run(strconv.Itoa(limit), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data := make([]map[string]any, 30)
				for i := range data {
					data[i] = map[string]any{"ts": 1760000000 + i, "temp": i}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": map[string]any{"pagination": map[string]any{"total_page": 1, "total_count": 30}, "data": data}})
			}))
			defer server.Close()
			client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api"})
			if err != nil {
				t.Fatal(err)
			}
			records, complete, err := client.listRecords(context.Background(), loraWANV2TelemetryConfig{GatewaySN: "GW"}, time.Unix(1750000000, 0), time.Unix(1770000000, 0), limit)
			if err != nil || len(records) != limit || complete != (limit == 30) {
				t.Fatalf("limit=%d records=%d complete=%t err=%v", limit, len(records), complete, err)
			}
		})
	}
}

func TestLoRaWANV2AdaptiveReadsWholeRangeAndSparseMetrics(t *testing.T) {
	pages := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pages++
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		data := make([]map[string]any, 50)
		for i := range data {
			index := (page-1)*50 + i
			data[i] = map[string]any{"ts": 1760000000 + index, "temp": index}
			if index%10 == 0 {
				data[i]["sparse"] = index
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": map[string]any{"pagination": map[string]any{"current_page": page, "total_page": 2}, "data": data}})
	}))
	defer server.Close()
	client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api"})
	if err != nil {
		t.Fatal(err)
	}
	series, rows, err := queryLoRaWANV2Metrics(context.Background(), client, loraWANV2TelemetryConfig{GatewaySN: "GW"}, []string{"temp", "sparse"}, time.Unix(1760000000, 0), time.Unix(1760000100, 0), 10, true, 10)
	if err != nil {
		t.Fatal(err)
	}
	dense := series["temp"]
	if pages != 2 || rows != 100 || !dense.Complete || !dense.Sampled || dense.SourceCount != 100 || len(dense.Points) > 10 || dense.Points[len(dense.Points)-1].Value != 99 {
		t.Fatalf("unexpected adaptive result: %#v, pages=%d rows=%d", dense, pages, rows)
	}
	if series["sparse"].SourceCount != 10 || !series["sparse"].Complete || len(series["sparse"].Warnings) != 1 {
		t.Fatalf("unexpected sparse result: %#v", series["sparse"])
	}
}

func TestLoRaWANV2DiscoveryUsesConfigurationWithoutRecentNodeData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/device/GW/infos" {
			_, _ = w.Write([]byte(`{"success":true,"payload":{"data":[],"pagination":{"total_page":1}}}`))
			return
		}
		if r.URL.Path == "/device/GW/node/1/sensor_config/latest" {
			_, _ = w.Write([]byte(`{"success":true,"payload":{"content":[["485",["request",[["temp","rule","℃"],["humi","rule","%"]]]]]}}`))
			return
		}
		t.Errorf("unexpected data discovery request: %s", r.URL.Path)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api"})
	if err != nil {
		t.Fatal(err)
	}
	streams, err := loraWANV2DiscoverStreams(context.Background(), client, LoRaWANV2Gateway{SN: "GW", NodeCount: 1})
	if err != nil || len(streams) != 6 {
		t.Fatalf("streams=%#v err=%v", streams, err)
	}
	wantDiagnostics := map[string]struct {
		name string
		unit string
	}{
		"lora_node_1_battery":      {name: "节点 1 · 电池电压", unit: "V"},
		"lora_node_1_rssi":         {name: "节点 1 · 接收信号强度", unit: "dBm"},
		"lora_node_1_sd_card_rate": {name: "节点 1 · SD 卡使用率", unit: "%"},
		"lora_node_1_snr":          {name: "节点 1 · 信噪比", unit: "dB"},
	}
	for _, stream := range streams {
		if expected, ok := wantDiagnostics[stream.Code]; ok {
			if stream.Name != expected.name || stream.Unit != expected.unit {
				t.Fatalf("incorrect diagnostic stream: %#v", stream)
			}
			delete(wantDiagnostics, stream.Code)
		}
	}
	if len(wantDiagnostics) != 0 {
		t.Fatalf("missing diagnostic streams: %#v", wantDiagnostics)
	}
}

func TestLoRaWANV2ConfigurationRejectsUnrecognizedAndDuplicateMetrics(t *testing.T) {
	for _, raw := range []string{`{"content":{}}`, `{"content":[["unknown"]]}`, `{"content":[["temp","r","℃"],["temp","r","℃"]]}`} {
		if _, err := parseLoRaWANV2MetricUnits(json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted invalid config: %s", raw)
		}
	}
}

func TestLoRaWANV2DiscoveryHandlesMissingAndSDIConfigurations(t *testing.T) {
	for _, tc := range []struct {
		name        string
		status      int
		body        string
		wantError   bool
		wantStreams int
	}{
		{"missing configuration", 404, `{"success":false,"error_code":"0x10011307","payload":null}`, false, 4},
		{"SDI without units", 200, `{"success":true,"payload":{"content":[["sdi",["0",[["RPFD","0"],["FRPFD","1"]]]]]}}`, false, 6},
		{"missing gateway", 404, `{"success":false,"error_code":"0x10011301"}`, true, 0},
		{"unregistered route", 404, ``, true, 0},
		{"server failure", 500, `{"success":false,"error_code":"0x10011308"}`, true, 0},
		{"unauthorized", 401, `{"success":false}`, true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/device/GW/infos":
					_, _ = w.Write([]byte(`{"success":true,"payload":{"data":[],"pagination":{"total_page":1}}}`))
				case "/device/GW/node/1/sensor_config/latest":
					w.WriteHeader(tc.status)
					_, _ = w.Write([]byte(tc.body))
				default:
					t.Errorf("unexpected request: %s", r.URL.Path)
					w.WriteHeader(500)
				}
			}))
			defer server.Close()
			client, err := newLoRaWANV2Client(context.Background(), staticResolver(`{"base_url":"`+server.URL+`","username":"reader","password":"secret"}`), DataSource{Type: "http_api"})
			if err != nil {
				t.Fatal(err)
			}
			streams, err := loraWANV2DiscoverStreams(context.Background(), client, LoRaWANV2Gateway{SN: "GW", NodeCount: 1})
			if (err != nil) != tc.wantError || len(streams) != tc.wantStreams {
				t.Fatalf("streams=%#v err=%v", streams, err)
			}
			if tc.name == "SDI without units" {
				byCode := make(map[string]loraWANV2StreamSpec, len(streams))
				for _, stream := range streams {
					byCode[stream.Code] = stream
				}
				if byCode["lora_node_1_frpfd"].Unit != "" || byCode["lora_node_1_rpfd"].Unit != "" {
					t.Fatalf("incorrect SDI metrics: %#v", streams)
				}
			}
		})
	}
}

func TestLoRaWANV2ConfigurationReadsIICKeys(t *testing.T) {
	units, err := parseLoRaWANV2MetricUnits(json.RawMessage(`{"content":[["iic",["9BSHT30","0x44",["ICt5","ICh5","pressure"]]]]}`))
	if err != nil || len(units) != 3 {
		t.Fatalf("units=%v err=%v", units, err)
	}
	for _, key := range []string{"ICt5", "ICh5", "pressure"} {
		if unit, ok := units[key]; !ok || unit != "" {
			t.Fatalf("missing or incorrect IIC metric %s: %v", key, units)
		}
	}
	for _, raw := range []string{
		`{"content":[["iic",["9BSHT30","0x44",["temp","temp"]]]]}`,
		`{"content":[["iic",["9BSHT30","0x44",["temp",12]]]]}`,
	} {
		if _, err := parseLoRaWANV2MetricUnits(json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted invalid IIC config: %s", raw)
		}
	}
}
