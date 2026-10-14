package datasource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/testdb"
)

func TestLoRaWANV2GatewayConfigurationContract(t *testing.T) {
	body := map[string]any{"content": map[string]any{"system": map[string]any{"did": "GW", "cid": float64(7)}, "platform": map[string]any{"settings_url": "http://host/device/{device_sn}/config"}}}
	config, err := normalizeLoRaWANV2GatewayConfig(body, "GW")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(config)
	if strings.Contains(string(raw), `"cid"`) || config["content"] != nil || !strings.Contains(string(raw), "{device_sn}") {
		t.Fatalf("incorrect upstream body: %s", raw)
	}
	if body["content"].(map[string]any)["system"].(map[string]any)["cid"] == nil {
		t.Fatal("normalization mutated caller draft")
	}
	if _, err := normalizeLoRaWANV2GatewayConfig(map[string]any{"system": map[string]any{"did": "other"}}, "GW"); err == nil {
		t.Fatal("accepted mismatched gateway identity")
	}
	if defaultLoRaWANV2GatewayConfig("GW")["system"].(map[string]any)["cid"] != nil {
		t.Fatal("default config specifies upstream-owned cid")
	}
}

func TestLoRaWANV2MetadataReadPermissionsAndContracts(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	owner, outsider, workspace, gateway, source := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []uuid.UUID{owner, outsider} {
		must(`INSERT INTO users(id,name,email) VALUES($1,'Metadata test',$2)`, id, id.String()+"@test.invalid")
	}
	must(`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','Test',$2)`, workspace, owner)
	must(`INSERT INTO workspace_members(workspace_id,user_id,role_id,scope_id,template_code) SELECT $1,$2,id,$1,'owner' FROM roles WHERE code='owner' AND workspace_id IS NULL LIMIT 1`, workspace, owner)
	must(`INSERT INTO workspace_member_permissions(member_id,permission_id) SELECT wm.id,rp.permission_id FROM workspace_members wm JOIN role_permissions rp ON rp.role_id=wm.role_id WHERE wm.workspace_id=$1`, workspace)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/device/GW/infos" {
			if r.URL.Query().Get("page_size") != "1" || len(r.URL.Query().Get("start_at")) != 10 {
				t.Error("unbounded or non-second info request")
			}
			fmt.Fprint(w, `{"success":true,"payload":{"data":[{"iccid":"00123456789012345678","firmware_version":"5.2.1"}]}}`)
			return
		}
		if r.URL.Path != "/device/GW/node/2/time_config/latest" {
			t.Errorf("unexpected upstream route %s", r.URL.Path)
		}
		fmt.Fprint(w, `{"success":true,"payload":{"id":12,"node_index":2,"content":"source schedule","wait_time":0,"created_at":"2026-10-13T01:00:00Z"}}`)
	}))
	defer server.Close()
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	t.Setenv("TEST_METADATA_SOURCE", string(secret))
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','env:TEST_METADATA_SOURCE',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,device_type,iccid) VALUES($1,'GW','gateway','11111111111111111111')`, gateway)
	must(`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, gateway, workspace)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	must(`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES($1,'lorawan_v2_nodes_count','Nodes','number','2',$2,$2)`, gateway, admin)
	h := NewHandler(NewService(db), permission.NewChecker(sqlc.New(db)))
	call := func(actor uuid.UUID, path string) *httptest.ResponseRecorder {
		r := gin.New()
		r.Use(func(c *gin.Context) { auth.SetActorContext(c, auth.Actor{UserID: actor}); c.Next() })
		r.GET("/devices/:device_id/nodes/:node_index/time-config", h.DeviceLoRaWANV2TimeConfig)
		r.GET("/devices/:device_id/lorawan-v2/info", h.DeviceLoRaWANV2Info)
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest("GET", path, bytes.NewReader(nil)))
		return response
	}
	prefix := "/devices/" + gateway.String()
	for _, fixture := range []struct {
		actor  uuid.UUID
		path   string
		status int
	}{{owner, prefix + "/nodes/2/time-config", 200}, {outsider, prefix + "/nodes/2/time-config", 403}, {owner, prefix + "/nodes/3/time-config", 400}, {owner, prefix + "/lorawan-v2/info", 200}} {
		response := call(fixture.actor, fixture.path)
		if response.Code != fixture.status {
			t.Fatalf("%s: got %d want %d: %s", fixture.path, response.Code, fixture.status, response.Body.String())
		}
		if strings.HasSuffix(fixture.path, "/info") && !strings.Contains(response.Body.String(), "00123456789012345678") {
			t.Fatal("reported ICCID lost leading zeros")
		}
	}
	var manual string
	if err := db.QueryRow(ctx, `SELECT iccid FROM devices WHERE id=$1`, gateway).Scan(&manual); err != nil || manual != "11111111111111111111" {
		t.Fatal("reported ICCID overwrote manual record", err)
	}
}

func TestLoRaWANV2TimeConfigurationMissingVersusUnavailable(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(map[bool]string{false: "unregistered route", true: "no saved configuration"}[missing], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(404)
				if missing {
					w.Write([]byte(`{"success":false,"error_code":"0x10011307","payload":null}`))
				}
			}))
			defer server.Close()
			base, _ := url.Parse(server.URL)
			client := &loraWANV2Client{baseURL: base, client: server.Client()}
			_, err := client.request(context.Background(), http.MethodGet, "/device/GW/node/1/time_config/latest", nil, nil)
			if err == nil {
				t.Fatal("missing error")
			}
			if missing && !errors.Is(err, errLoRaWANV2SensorConfigNotFound) {
				t.Fatalf("lost no-config marker: %v", err)
			}
			if !missing && !strings.Contains(err.Error(), "GET") {
				t.Fatalf("unavailable route not identified: %v", err)
			}
		})
	}
}
