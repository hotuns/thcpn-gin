package datasource

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

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
	units := loraWANV2NodeMetricUnits(context.Background(), client, "GW-1", 1)
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
