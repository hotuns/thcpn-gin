package lorawanv2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestPhysicalNodeOperationsSynchronizeOnlyAffectedNode(t *testing.T) {
	for _, scenario := range []struct {
		name           string
		action         string
		projectionFail bool
	}{
		{name: "bind", action: "bind"},
		{name: "replace", action: "replace"},
		{name: "replace projection failure", action: "replace", projectionFail: true},
		{name: "unbind", action: "unbind"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			db := testdb.Open(t, 0)
			ctx := t.Context()
			actor := testdb.Admin(t, db)
			source, gateway := uuid.New(), uuid.New()
			must := func(query string, args ...any) {
				t.Helper()
				if _, err := db.Exec(ctx, query, args...); err != nil {
					t.Fatal(err)
				}
			}
			must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by)
				VALUES($1,'Source','http_api','lorawan_v2','secret:test',$2)`, source, actor)
			must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')`, gateway)
			must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key)
				VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
			must(`INSERT INTO node_profiles(device_id,node_index,name,latitude,longitude,updated_by,updated_by_type)
				VALUES($1,3,'样地三',30,120,$2,'system_admin')`, gateway, actor)
			must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index)
				VALUES($1,100,'NEW',NULL,NULL),($1,111,'UNRELATED',$2,11)`, source, gateway)
			previouslyBound := scenario.action != "bind"
			if previouslyBound {
				must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index)
					VALUES($1,3,'OLD',$2,3)`, source, gateway)
			}
			s := newTestService(db)
			seed := func(index int) {
				t.Helper()
				binding, err := json.Marshal(loraWANV2TelemetryConfig{GatewaySN: "GW", NodeIndex: &index, Metric: "temp"})
				if err != nil {
					t.Fatal(err)
				}
				if err := s.persistDiscoveredNodeStreams(ctx, source, gateway, actor, []loraWANV2StreamSpec{{
					Code: fmt.Sprintf("lora_node_%d_temp", index), Name: "温度", Unit: "C", AdapterConfig: binding, ConfigHash: "original",
				}}); err != nil {
					t.Fatal(err)
				}
			}
			seed(11)
			if previouslyBound {
				seed(3)
			}
			unrelatedSnapshot := func() string {
				t.Helper()
				var value string
				if err := db.QueryRow(ctx, `SELECT jsonb_agg(jsonb_build_object('stream',to_jsonb(ds),'binding',to_jsonb(b)) ORDER BY ds.id)::text
					FROM data_streams ds JOIN data_stream_bindings b ON b.data_stream_id=ds.id
					WHERE ds.device_id=$1 AND b.adapter_config_json->>'node_index'='11'`, gateway).Scan(&value); err != nil {
					t.Fatal(err)
				}
				return value
			}
			beforeUnrelated := unrelatedSnapshot()
			var previousStream uuid.UUID
			if previouslyBound {
				if err := db.QueryRow(ctx, `SELECT id FROM data_streams WHERE device_id=$1 AND code='lora_node_3_temp'`, gateway).Scan(&previousStream); err != nil {
					t.Fatal(err)
				}
			}
			index, otherIndex := 3, 11
			gatewaySN := "GW"
			operated := false
			writes, directories, gateways, configurations := 0, 0, 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var value any
				switch {
				case scenario.action == "bind" && r.Method == http.MethodPut && r.URL.Path == "/nodes/NEW/binding":
					var body struct {
						GatewaySN string `json:"gateway_sn"`
						NodeIndex int    `json:"node_index"`
					}
					if json.NewDecoder(r.Body).Decode(&body) != nil || body.GatewaySN != "GW" || body.NodeIndex != 3 {
						t.Error("invalid binding request")
					}
					writes++
					operated = true
					value = PhysicalNode{ID: 100, SN: "NEW", GatewaySN: &gatewaySN, NodeIndex: &index}
				case scenario.action == "replace" && r.Method == http.MethodPost && r.URL.Path == "/device/GW/node/3/replace":
					var body struct {
						SN string `json:"new_node_sn"`
					}
					if json.NewDecoder(r.Body).Decode(&body) != nil || body.SN != "NEW" {
						t.Error("invalid replacement request")
					}
					writes++
					operated = true
					value = PhysicalNode{ID: 100, SN: "NEW", GatewaySN: &gatewaySN, NodeIndex: &index}
				case scenario.action == "unbind" && r.Method == http.MethodDelete && r.URL.Path == "/nodes/OLD/binding":
					writes++
					operated = true
					value = PhysicalNode{ID: 3, SN: "OLD"}
				case r.Method == http.MethodGet && r.URL.Path == "/device/GW/nodes":
					directories++
					list := []PhysicalNode{{ID: 111, SN: "UNRELATED", GatewaySN: &gatewaySN, NodeIndex: &otherIndex}}
					if operated && scenario.action != "unbind" {
						list = append(list, PhysicalNode{ID: 100, SN: "NEW", GatewaySN: &gatewaySN, NodeIndex: &index})
					} else if !operated && previouslyBound {
						list = append(list, PhysicalNode{ID: 3, SN: "OLD", GatewaySN: &gatewaySN, NodeIndex: &index})
					}
					value = PhysicalNodes{GatewaySN: "GW", BoundNodeCount: len(list), Data: list}
				case r.Method == http.MethodGet && r.URL.Path == "/device/GW":
					gateways++
					value = map[string]any{"sn": "GW", "node_count": 254}
				case r.Method == http.MethodGet && r.URL.Path == "/device/GW/node/3/sensor_config/latest":
					configurations++
					if scenario.projectionFail {
						w.WriteHeader(http.StatusServiceUnavailable)
						fmt.Fprint(w, `{"success":false}`)
						return
					}
					fmt.Fprint(w, `{"success":true,"payload":{"id":30,"content":[["ad",[["temp","1,0","C"]],1]]}}`)
					return
				default:
					t.Errorf("node operation rescanned an unrelated node or gateway telemetry: %s %s", r.Method, r.URL.Path)
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				raw, err := json.Marshal(value)
				if err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				fmt.Fprintf(w, `{"success":true,"payload":%s}`, raw)
			}))
			defer server.Close()
			secret, err := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
			if err != nil {
				t.Fatal(err)
			}
			s.Runtime = platform.NewRuntime(staticResolver(secret))
			sn := "NEW"
			if scenario.action == "unbind" {
				sn = "OLD"
			}
			result, err := s.OperatePhysicalNode(ctx, gateway, actor, PhysicalNodeCommand{Action: scenario.action, SN: sn, NodeIndex: 3})
			wantStatus := "completed"
			if scenario.projectionFail {
				wantStatus = "partial"
			}
			if err != nil || result.Status != wantStatus || result.OperationID == uuid.Nil || writes != 1 {
				t.Fatalf("unexpected node operation: %+v, error=%v, writes=%d", result, err, writes)
			}
			wantDirectories, wantConfigurations := 1, 1
			if scenario.action == "unbind" {
				wantDirectories, wantConfigurations = 2, 0
			}
			if directories != wantDirectories || gateways != wantConfigurations || configurations != wantConfigurations {
				t.Fatalf("unexpected synchronization requests: directory=%d gateway=%d config=%d", directories, gateways, configurations)
			}
			if got := unrelatedSnapshot(); got != beforeUnrelated {
				t.Fatal("node operation rewrote unrelated metrics or their binding timestamps")
			}
			var localSN string
			if scenario.action == "unbind" {
				var current int
				if err := db.QueryRow(ctx, `SELECT count(*) FROM lorawan_physical_nodes WHERE gateway_device_id=$1 AND node_index=3`, gateway).Scan(&current); err != nil || current != 0 {
					t.Fatalf("unbound node still installed: %d %v", current, err)
				}
			} else if err := db.QueryRow(ctx, `SELECT sn FROM lorawan_physical_nodes WHERE gateway_device_id=$1 AND node_index=3`, gateway).Scan(&localSN); err != nil || localSN != "NEW" {
				t.Fatalf("accepted source binding missing from platform: %q %v", localSN, err)
			}
			if previouslyBound {
				var oldUnbound bool
				if err := db.QueryRow(ctx, `SELECT gateway_device_id IS NULL AND node_index IS NULL FROM lorawan_physical_nodes WHERE data_source_id=$1 AND external_id=3`, source).Scan(&oldUnbound); err != nil || !oldUnbound {
					t.Fatalf("old physical node remains installed: %v", err)
				}
			}
			if !scenario.projectionFail && scenario.action != "unbind" {
				var streamID uuid.UUID
				if err := db.QueryRow(ctx, `SELECT id FROM data_streams WHERE device_id=$1 AND code='lora_node_3_temp' AND status='active' AND purpose='measurement'`, gateway).Scan(&streamID); err != nil {
					t.Fatalf("affected measurement was not synchronized: %v", err)
				}
				if previouslyBound && streamID != previousStream {
					t.Fatal("replacement recreated the historical measurement identity")
				}
				var diagnostics int
				if err := db.QueryRow(ctx, `SELECT count(*) FROM data_streams WHERE device_id=$1 AND code LIKE 'lora_node_3_%' AND purpose='status' AND status='active'`, gateway).Scan(&diagnostics); err != nil || diagnostics != 4 {
					t.Fatalf("affected runtime metrics missing: %d %v", diagnostics, err)
				}
			}
			var storedStatus, storedError string
			if err := db.QueryRow(ctx, `SELECT status,COALESCE(error,'') FROM source_operations WHERE id=$1`, result.OperationID).Scan(&storedStatus, &storedError); err != nil || storedStatus != wantStatus || scenario.projectionFail && !strings.Contains(storedError, "sensor configuration") {
				t.Fatalf("incorrect source operation result: status=%q error=%q, %v", storedStatus, storedError, err)
			}
			var name string
			if err := db.QueryRow(ctx, `SELECT name FROM node_profiles WHERE device_id=$1 AND node_index=3`, gateway).Scan(&name); err != nil || name != "样地三" {
				t.Fatalf("node operation changed the position profile: %q %v", name, err)
			}
		})
	}
}
