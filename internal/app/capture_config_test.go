package app

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func workspaceCaptureTest(t *testing.T) (*pgxpool.Pool, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, func(uuid.UUID, string, string, string, int) string) {
	t.Helper()
	db := testdb.Open(t, 0)
	owner, viewer, outsider, demo, workspace := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(t.Context(), query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []uuid.UUID{owner, viewer, outsider} {
		must(`INSERT INTO users(id,name,email) VALUES($1,'Capture test',$2)`, id, id.String()+"@test.invalid")
	}
	must(`INSERT INTO users(id,name,username,is_demo) VALUES($1,'Capture demo','capture-demo',true)`, demo)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','Capture test',$2)`, workspace, owner)
	for _, row := range []struct {
		id   uuid.UUID
		role string
	}{{owner, "owner"}, {viewer, "viewer"}, {demo, "site_operator"}} {
		must(`INSERT INTO workspace_members(workspace_id,user_id,role_id,scope_id,template_code) SELECT $1,$2,id,$1,$3 FROM roles WHERE code=$3 AND workspace_id IS NULL LIMIT 1`, workspace, row.id, row.role)
	}
	must(`INSERT INTO workspace_member_permissions(member_id,permission_id) SELECT wm.id,rp.permission_id FROM workspace_members wm JOIN role_permissions rp ON rp.role_id=wm.role_id WHERE wm.workspace_id=$1`, workspace)
	cfg := config.Default()
	cfg.Auth.DevUserHeaderEnabled = true
	router, err := NewRouter(Dependencies{Postgres: db, Config: cfg, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	request := func(actor uuid.UUID, method, path, body string, want int) string {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if actor != uuid.Nil {
			req.Header.Set(auth.HeaderUserID, actor.String())
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("%s %s: want %d, got %d: %s", method, path, want, response.Code, response.Body.String())
		}
		return response.Body.String()
	}
	return db, owner, viewer, outsider, demo, workspace, request
}

func TestWorkspaceCaptureConfigEditsOnlyReviewedFields(t *testing.T) {
	mysql, dsn := testdb.MySQL(t, "workspace_capture_"+strings.ReplaceAll(uuid.NewString(), "-", ""))
	db, owner, viewer, outsider, demo, workspace, request := workspaceCaptureTest(t)
	ctx := t.Context()
	if _, err := mysql.ExecContext(ctx, `CREATE TABLE device_config(id BIGINT PRIMARY KEY AUTO_INCREMENT,device_id BIGINT NOT NULL,data JSON,image JSON,control JSON,version VARCHAR(20),uuid VARCHAR(64),is_mg INT,created_at DATETIME,updated_at DATETIME,deleted_at DATETIME)`); err != nil {
		t.Fatal(err)
	}
	const sensors = `[{"sensorType":"SHT30","port":"485","port_num":"1","sensor":"modbusrtu","params":{"command":"0103","contents":[{"key":"temp","info":{"name":"Temperature","unit":"C"}}],"custom":"keep-sensor"}}]`
	const images = `[{"key":"near","name":"Near camera","port":"http","port_num":0,"password":"fixture-private-value"}]`
	const schedule = `{"data_capture_invl":"0,30 *","img_capture_invl":"10 8,10","device_key":"fixture-private-key"}`
	if _, err := mysql.ExecContext(ctx, `INSERT INTO device_config(id,device_id,data,image,control) VALUES(7,42,?,?,?)`, sensors, images, schedule); err != nil {
		t.Fatal(err)
	}
	admin, source, deviceID := testdb.Admin(t, db), uuid.New(), uuid.New()
	t.Setenv("TEST_WORKSPACE_CAPTURE_DSN", dsn)
	for _, stmt := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Capture THCPN','mysql','thcpn','env:TEST_WORKSPACE_CAPTURE_DSN',$2)`, []any{source, admin}},
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'Test station','standalone')`, []any{deviceID}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'thcpn_legacy_mysql','42')`, []any{deviceID, source}},
		{`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, []any{deviceID, workspace}},
	} {
		if _, err := db.Exec(ctx, stmt.query, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	path := "/devices/" + deviceID.String() + "/capture-config"
	const change = `{"expected_version":7,"risk_confirmed":true,"changes":[{"section":"sensor","item_id":"1","metric":1,"fields":{"name":"Air temperature"}},{"section":"camera","item_id":"channel:1","fields":{"channel":"2"}}]}`
	request(uuid.Nil, http.MethodGet, path, "", http.StatusUnauthorized)
	for _, actor := range []uuid.UUID{viewer, outsider, demo} {
		request(actor, http.MethodGet, path, "", http.StatusForbidden)
		request(actor, http.MethodPatch, path, change, http.StatusForbidden)
	}
	read := request(owner, http.MethodGet, path, "", http.StatusOK)
	for _, forbidden := range []string{"fixture-private", "keep-sensor", "data_capture_invl", "control_json", "external_device_id"} {
		if strings.Contains(read, forbidden) {
			t.Fatalf("workspace capture settings exposed %q", forbidden)
		}
	}
	var draft platform.CaptureConfig
	if err := json.Unmarshal([]byte(read), &draft); err != nil || draft.Version != 7 || len(draft.Sensors) != 1 || len(draft.Cameras) != 1 || !draft.HasCameras {
		t.Fatalf("unexpected capture settings: %s (%v)", read, err)
	}
	request(owner, http.MethodPatch, path, strings.Replace(change, `"risk_confirmed":true`, `"risk_confirmed":false`, 1), http.StatusBadRequest)
	request(owner, http.MethodPatch, path, strings.Replace(change, `"channel":"2"`, `"password":"new value"`, 1), http.StatusBadRequest)
	saved := request(owner, http.MethodPatch, path, change, http.StatusOK)
	if !strings.Contains(saved, `"source":"accepted"`) || !strings.Contains(saved, `"platform":"synced"`) || strings.Contains(saved, "fixture-private") {
		t.Fatalf("unexpected save outcome: %s", saved)
	}
	request(owner, http.MethodPatch, path, change, http.StatusConflict)
	var id int
	var data, image, control string
	if err := mysql.QueryRowContext(ctx, `SELECT id,data,image,control FROM device_config WHERE device_id=42 ORDER BY id DESC LIMIT 1`).Scan(&id, &data, &image, &control); err != nil {
		t.Fatal(err)
	}
	if id != 8 || !strings.Contains(data, "Air temperature") || !strings.Contains(data, "keep-sensor") || !strings.Contains(image, "fixture-private-value") || !strings.Contains(image, `"port_num": 2`) || !platform.JsonSemanticallyEqual([]byte(control), []byte(schedule)) {
		t.Fatalf("unexpected source change: version=%d data=%s image=%s control=%s", id, data, image, control)
	}
	if after := request(owner, http.MethodPatch, path, strings.Replace(change, `"expected_version":7`, `"expected_version":8`, 1), http.StatusOK); !strings.Contains(after, `"source":"unchanged"`) {
		t.Fatalf("equivalent capture settings wrote the source: %s", after)
	}
	var operations int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM source_operations WHERE device_id=$1 AND actor_id=$2 AND NOT (request::text LIKE '%fixture-private%')`, deviceID, owner).Scan(&operations); err != nil || operations != 1 {
		t.Fatalf("expected one sanitized source operation, got %d: %v", operations, err)
	}

	// Legacy stations may store both image aliases and telemetry in the data dictionary.
	if _, err := mysql.ExecContext(ctx, `INSERT INTO device_config(id,device_id,data,image,control) VALUES(9,42,'{"legacy_image":{"type":"image","desc":"Legacy camera","extra":"keep"},"legacy_temp":{"unit":"C","desc":"Legacy temp"}}','{}',?)`, schedule); err != nil {
		t.Fatal(err)
	}
	if read := request(owner, http.MethodGet, path, "", http.StatusOK); !strings.Contains(read, `"id":"legacy:legacy_image"`) {
		t.Fatalf("legacy image alias is missing: %s", read)
	}
	request(owner, http.MethodPatch, path, `{"expected_version":9,"risk_confirmed":true,"changes":[{"section":"camera","item_id":"legacy:legacy_image","fields":{"name":"Field camera"}}]}`, http.StatusOK)
	if err := mysql.QueryRowContext(ctx, `SELECT id,data,image,control FROM device_config WHERE device_id=42 ORDER BY id DESC LIMIT 1`).Scan(&id, &data, &image, &control); err != nil || id != 10 || !strings.Contains(data, "Field camera") || !strings.Contains(data, `"extra": "keep"`) || image != "{}" || !platform.JsonSemanticallyEqual([]byte(control), []byte(schedule)) {
		t.Fatalf("legacy source shape or unchanged settings were lost: %d %s %s (%v)", id, data, image, err)
	}
}

func TestWorkspaceLoRaSensorConfigChecksBindingAndVersion(t *testing.T) {
	db, owner, viewer, outsider, demo, workspace, request := workspaceCaptureTest(t)
	ctx := t.Context()
	admin, source, gateway := testdb.Admin(t, db), uuid.New(), uuid.New()
	var posts atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			t.Errorf("unexpected source write: %s", r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		switch r.URL.Path {
		case "/device/GW/nodes":
			fmt.Fprint(w, `{"success":true,"payload":{"gateway_sn":"GW","bound_node_count":1,"data":[{"id":1,"sn":"NODE-3","gateway_sn":"GW","node_index":3}]}}`)
		case "/device/GW/node/3/sensor_config/latest":
			fmt.Fprint(w, `{"success":true,"payload":{"id":9,"wait_time":60,"content":[["ad",[["temp","1,0","C"]],1]]}}`)
		case "/device/GW":
			fmt.Fprint(w, `{"success":true,"payload":{"sn":"GW","node_count":3}}`)
		default:
			t.Errorf("unexpected source read: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	secret, _ := json.Marshal(map[string]string{"base_url": upstream.URL, "username": "test", "password": "test"})
	t.Setenv("TEST_WORKSPACE_LORA_CAPTURE", string(secret))
	for _, stmt := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Capture LoRa','http_api','lorawan_v2','env:TEST_WORKSPACE_LORA_CAPTURE',$2)`, []any{source, admin}},
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'Test gateway','gateway')`, []any{gateway}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, []any{gateway, source}},
		{`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, []any{gateway, workspace}},
	} {
		if _, err := db.Exec(ctx, stmt.query, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	path := "/devices/" + gateway.String() + "/nodes/3/sensor-config"
	const change = `{"expected_version":9,"risk_confirmed":true,"mode":"metrics","node_sn":"NODE-3","metrics":[{"key":"temp","name":"Air temperature","unit":"C"}]}`
	for _, actor := range []uuid.UUID{viewer, outsider, demo} {
		request(actor, http.MethodGet, path, "", http.StatusForbidden)
		request(actor, http.MethodPatch, path, change, http.StatusForbidden)
	}
	if result := request(owner, http.MethodGet, path, "", http.StatusOK); !strings.Contains(result, `"node_sn":"NODE-3"`) || !strings.Contains(result, `"version":9`) {
		t.Fatalf("unexpected node configuration: %s", result)
	}
	request(owner, http.MethodPatch, strings.Replace(path, "/nodes/3/", "/nodes/2/", 1), change, http.StatusNotFound)
	request(owner, http.MethodPatch, path, strings.Replace(change, "NODE-3", "OLD-NODE", 1), http.StatusConflict)
	request(owner, http.MethodPatch, path, strings.Replace(change, `"expected_version":9`, `"expected_version":8`, 1), http.StatusConflict)
	saved := request(owner, http.MethodPatch, path, change, http.StatusOK)
	if !strings.Contains(saved, `"source":"unchanged"`) || !strings.Contains(saved, `"platform":"synced"`) || posts.Load() != 0 {
		t.Fatalf("metadata-only save should keep source configuration: %s", saved)
	}
	if read := request(owner, http.MethodGet, path, "", http.StatusOK); !strings.Contains(read, "Air temperature") {
		t.Fatalf("platform change missing on re-read: %s", read)
	}
}
