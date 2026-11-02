package export

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/testdb"
)

func TestV2ExportSeparatesMeasurementsFromStatus(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	gateway, source := uuid.New(), uuid.New()
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO devices(id,name,serial_no,device_type) VALUES($1,'Gateway','GATEWAY-SN','gateway')`, gateway)
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'v2','http_api','lorawan_v2','env:UNUSED',$2)`, source, admin)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GATEWAY-SN')`, gateway, source)
	must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index) VALUES($1,1,'NODE-SN',$2,1),($1,2,'UNSELECTED-NODE',$2,2)`, source, gateway)
	purposes := map[uuid.UUID]string{}
	for _, tc := range []struct{ key, purpose, node string }{{"temp", "measurement", "1"}, {"battery", "status", "1"}, {"rssi", "status", "1"}, {"battery", "status", "2"}, {"battery", "status", ""}, {"longitude", "location", ""}} {
		id := uuid.New()
		purposes[id] = tc.purpose + tc.node
		cfg := `{"gateway_sn":"GATEWAY-SN","metric":"` + tc.key + `"}`
		if tc.node != "" {
			cfg = `{"gateway_sn":"GATEWAY-SN","node_index":` + tc.node + `,"metric":"` + tc.key + `"}`
		}
		must(`INSERT INTO data_streams(id,device_id,code,name,type,purpose,created_by,created_by_type) VALUES($1,$2,$3,$4,'telemetry',$5,$6,'system_admin')`, id, gateway, tc.node+tc.key, tc.key, tc.purpose, admin)
		must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,payload_type,adapter_code,adapter_config_json,created_by,created_by_type) VALUES($1,$2,'json','lorawan_v2',$3,$4,'system_admin')`, id, source, cfg, admin)
	}
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	index := 1
	for _, tc := range []struct {
		name         string
		data, status bool
		noNodes      bool
		calls        int
	}{{"data", true, false, false, 1}, {"status", false, true, false, 4}, {"both", true, true, false, 5}, {"gateway only", false, true, true, 2}} {
		t.Run(tc.name, func(t *testing.T) {
			called := map[uuid.UUID]bool{}
			runtime := segmentedRuntime{telemetry: func(q platform.TelemetryQuery) (platform.TelemetryResult, error) {
				called[q.Binding.DataStreamID] = true
				if purposes[q.Binding.DataStreamID] == "status2" {
					t.Fatal("queried an unselected node")
				}
				return platform.TelemetryResult{Complete: true, Points: []platform.TelemetryPoint{{Timestamp: start, Value: 12.5}}}, nil
			}}
			p := NewProcessor(db, nil, runtime, &exportTestStore{}, config.ExportConfig{}, nil)
			cfg := batchExportConfig{GatewayID: gateway.String(), GatewayName: "Gateway", DeviceIDs: []string{gateway.String()}, StartTime: start, EndTime: start.Add(time.Hour), IncludeData: tc.data, IncludeStatus: tc.status, NodeTargets: []device.NodeTarget{{Kind: "gateway_node", GatewayDeviceID: &gateway, NodeIndex: &index}}}
			if tc.noNodes {
				cfg.NodeTargets = nil
			}
			raw, _ := json.Marshal(cfg)
			validator := NewService(db, nil, config.ExportConfig{})
			if err := validator.validateDeviceBatch(ctx, uuid.Nil, uuid.Nil, gateway, "group_site_zip", raw, true); err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			if err := p.renderIndexedNodeZIP(ctx, cfg, &output); err != nil {
				t.Fatal(err)
			}
			if len(called) != tc.calls {
				t.Fatalf("queried %d streams, want %d", len(called), tc.calls)
			}
			archive, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
			if err != nil {
				t.Fatal(err)
			}
			files := map[string]string{}
			for _, f := range archive.File {
				reader, _ := f.Open()
				body, _ := io.ReadAll(reader)
				reader.Close()
				files[f.Name] = string(body)
			}
			if _, ok := files["node-1/data.csv"]; ok != tc.data {
				t.Fatal("wrong measurement file selection")
			}
			if tc.data && strings.Contains(files["node-1/data.csv"], "battery") {
				t.Fatal("status leaked into measurements")
			}
			status, ok := files["运行状态.csv"]
			if ok != tc.status {
				t.Fatal("wrong status file selection")
			}
			if tc.status {
				rows, err := csv.NewReader(strings.NewReader(status)).ReadAll()
				if err != nil {
					t.Fatal(err)
				}
				wantRows := 3
				if tc.noNodes {
					wantRows = 2
				}
				if len(rows) != wantRows || (!tc.noNodes && !strings.Contains(status, "NODE-SN")) || !strings.Contains(status, "longitude") || strings.Contains(status, "temp") {
					t.Fatalf("wrong status wide table %s", status)
				}
				for _, row := range rows[1:] {
					if row[0] != "GATEWAY-SN" || row[4] != "2026-11-01 08:00:00+08:00" && !strings.HasPrefix(row[4], "2026-11-01 08:00:00") {
						t.Fatalf("identity/time lost: %v", row)
					}
				}
			}
		})
	}
}
