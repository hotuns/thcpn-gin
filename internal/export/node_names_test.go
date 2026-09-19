package export

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/testdb"
)

func TestNodeNameSnapshotSurvivesRename(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	gateway, source, carbon := uuid.New(), uuid.New(), uuid.New()
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','env:NOT_USED',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway'),($2,'Carbon','carbon_sink')`, gateway, carbon)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','TEST')`, gateway, source)
	must(`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES($1,'lorawan_v2_nodes_count','Nodes','number','2',$2,$2)`, gateway, admin)
	for _, id := range []uuid.UUID{gateway, carbon} {
		must(`INSERT INTO node_profiles(device_id,node_index,name,updated_by,updated_by_type) VALUES($1,1,'创建时名称',$2,'system_admin')`, id, admin)
	}
	svc := NewService(db, nil, config.ExportConfig{})
	index := 1
	target := device.NodeTarget{Kind: "gateway_node", GatewayDeviceID: &gateway, NodeIndex: &index}
	raw, _ := json.Marshal(batchExportConfig{GatewayID: gateway.String(), NodeTargets: []device.NodeTarget{target}, NodeNames: map[string]string{target.Key(): "伪造名称"}})
	snapshot, err := svc.snapshotNodeNames(ctx, "device_batch", gateway, raw)
	if err != nil {
		t.Fatal(err)
	}
	var cfg batchExportConfig
	if err = json.Unmarshal(snapshot, &cfg); err != nil {
		t.Fatal(err)
	}
	must(`UPDATE node_profiles SET name='后来改名' WHERE device_id=$1`, gateway)
	p := Processor{devices: device.NewService(db)}
	body, err := p.renderIndexedNodeZIP(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range zr.File {
		r, _ := file.Open()
		b, _ := io.ReadAll(r)
		r.Close()
		if strings.Contains(string(b), "后来改名") || strings.Contains(string(b), "伪造名称") {
			t.Fatalf("unstable snapshot %s", b)
		}
		if file.Name == "node-1/data.csv" && !strings.Contains(string(b), "node_index,node_name") {
			t.Fatalf("node columns missing %s", b)
		}
	}
	if len(cfg.NodeNames) != 1 || cfg.NodeNames[target.Key()] != "创建时名称 · 节点 1" {
		t.Fatal(cfg.NodeNames)
	}
	carbonRaw, err := svc.snapshotNodeNames(ctx, "device", carbon, []byte(`{"node_ids":[1]}`))
	if err != nil {
		t.Fatal(err)
	}
	var carbonCfg carbonStationExportConfig
	_ = json.Unmarshal(carbonRaw, &carbonCfg)
	if carbonCfg.NodeNames["1"] != "创建时名称 · 节点 1" {
		t.Fatal(carbonCfg.NodeNames)
	}
}
func TestNodeCSVColumnsPreserveIdentityAndEscaping(t *testing.T) {
	body, err := appendNodeColumns([]byte("ts,value\n2026-09-18,4\n"), "3", "林下,\"温度\" · 节点 3", true)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := csv.NewReader(bytes.NewReader(body)).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if rows[1][1] != "4" || rows[1][2] != "3" || rows[1][3] != "林下,\"温度\" · 节点 3" {
		t.Fatal(rows)
	}
}
