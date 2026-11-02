package datasource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/testdb"
)

func TestRuntimePageReadsOnlySelectedBoundNodesAndMapsHistory(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	gateway, source, other := uuid.New(), uuid.New(), uuid.New()
	var mu sync.Mutex
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.URL.Path)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Method != "GET" || r.URL.RawQuery != "" {
			t.Errorf("latest used history parameters: %s", r.URL.String())
		}
		if r.URL.Path == "/device/GW/info" {
			fmt.Fprint(w, `{"success":true,"payload":{"ts":{"$date":{"$numberLong":"1700000000000"}},"battery":12.5,"cell":99}}`)
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/latest") {
			t.Errorf("unexpected source route: %s", r.URL.Path)
		}
		fmt.Fprint(w, `{"success":true,"payload":{"ts":1700000000,"battery":3.6,"rssi":-71,"sd_card_rate":0.03,"snr":0}}`)
	}))
	defer server.Close()
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	t.Setenv("RUNTIME_STATUS_TEST_SOURCE", string(secret))
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'v2','http_api','lorawan_v2','env:RUNTIME_STATUS_TEST_SOURCE',$2)`, source, admin)
	for _, id := range []uuid.UUID{gateway, other} {
		must(`INSERT INTO devices(id,name,device_type) VALUES($1,'GW','gateway')`, id)
	}
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	must(`INSERT INTO node_profiles(device_id,node_index,name,updated_by,updated_by_type) SELECT $1,n,'',$2,'system_admin' FROM generate_series(1,254)n`, gateway, admin)
	for index := 1; index <= 100; index++ {
		must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index) VALUES($1,$2,$3,$4,$5)`, source, index, fmt.Sprintf("NODE-%d", index), gateway, index)
	}
	must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index) VALUES($1,200,'OTHER-GW-NODE',$2,200)`, source, other)
	ids := map[string]uuid.UUID{}
	for _, tc := range []struct {
		key  string
		node int
	}{{"battery", 3}, {"sd_card_rate", 3}, {"battery", 0}, {"cell", 0}} {
		id := uuid.New()
		ids[fmt.Sprintf("%d/%s", tc.node, tc.key)] = id
		config := map[string]any{"gateway_sn": "GW", "metric": tc.key}
		if tc.node > 0 {
			config["node_index"] = tc.node
		}
		raw, _ := json.Marshal(config)
		must(`INSERT INTO data_streams(id,device_id,code,name,type,purpose,created_by,created_by_type) VALUES($1,$2,$3,$3,'telemetry','status',$4,'system_admin')`, id, gateway, fmt.Sprintf("metric-%d-%s", tc.node, tc.key), admin)
		must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,adapter_code,payload_type,adapter_config_json,created_by,created_by_type) VALUES($1,$2,'lorawan_v2','json',$3,$4,'system_admin')`, id, source, raw, admin)
	}
	handler := NewHandler(NewService(db), permission.NewChecker(sqlc.New(db)))
	router := gin.New()
	router.Use(func(c *gin.Context) {
		auth.SetActorContext(c, auth.Actor{UserID: admin, IsSystemAdmin: true})
		c.Next()
	})
	router.GET("/devices/:device_id/nodes/runtime", handler.NodeRuntime)
	router.GET("/devices/:device_id/info", handler.AdminDeviceLoRaWANV2Info)
	get := func(path string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/devices/"+gateway.String()+path, nil))
		return response
	}
	response := get("/nodes/runtime?node_indices=3,100")
	var result struct {
		Items []struct {
			Key     string               `json:"key"`
			SD      *float64             `json:"sd_card_rate"`
			SNR     *float64             `json:"snr"`
			History map[string]uuid.UUID `json:"history_stream_ids"`
		} `json:"items"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Items) != 2 {
		t.Fatalf("page read failed %d %s", response.Code, response.Body.String())
	}
	mu.Lock()
	count := len(calls)
	mu.Unlock()
	if count != 2 {
		t.Fatalf("swept extra nodes: %d", count)
	}
	if result.Items[0].SD == nil || *result.Items[0].SD != 3 || result.Items[0].SNR == nil || *result.Items[0].SNR != 0 || result.Items[0].History["battery"] != ids["3/battery"] || result.Items[0].History["sd_card_rate"] != ids["3/sd_card_rate"] {
		t.Fatalf("diagnostics or history lost: %+v", result.Items[0])
	}
	for _, input := range []string{"200", "254", "0", "255", "x", ""} {
		if response := get("/nodes/runtime?node_indices=" + input); response.Code != 400 {
			t.Fatalf("accepted invalid page %s: %d", input, response.Code)
		}
	}
	mu.Lock()
	count = len(calls)
	mu.Unlock()
	if count != 2 {
		t.Fatal("invalid selection accessed the source")
	}
	info := get("/info")
	var payload struct {
		Battery float64              `json:"battery"`
		Cell    int                  `json:"cell"`
		History map[string]uuid.UUID `json:"history_stream_ids"`
	}
	if info.Code != 200 || json.Unmarshal(info.Body.Bytes(), &payload) != nil || payload.Cell != 99 || payload.Battery != 12.5 || payload.History["cell"] != ids["0/cell"] || payload.History["battery"] != ids["0/battery"] {
		t.Fatalf("gateway mapping lost %d %s", info.Code, info.Body.String())
	}
	must(`UPDATE data_streams SET status='disabled' WHERE id=$1`, ids["0/cell"])
	info = get("/info")
	if err := json.Unmarshal(info.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(info.Body.Bytes(), &raw)
	var mappings map[string]uuid.UUID
	_ = json.Unmarshal(raw["history_stream_ids"], &mappings)
	if _, exists := mappings["cell"]; exists {
		t.Fatal("disabled channel offered as history")
	}
}
