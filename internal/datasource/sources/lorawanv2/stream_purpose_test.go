package lorawanv2

import (
	"encoding/json"
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/testdb"
)

func TestStreamPurposeClassification(t *testing.T) {
	index := 1
	for _, tc := range []struct {
		node      *int
		key, want string
	}{
		{nil, "battery", "status"}, {nil, "cell", "status"}, {nil, "custom_number", "status"},
		{nil, "longitude", "location"}, {nil, "latitude", "location"}, {nil, "altitude", "location"},
		{&index, "battery", "status"}, {&index, "rssi", "status"}, {&index, "snr", "status"}, {&index, "sd_card_rate", "status"},
		{&index, "temp", "measurement"}, {&index, "longitude", "location"},
	} {
		if got := loRaWANV2StreamPurpose(tc.node, tc.key); got != tc.want {
			t.Fatalf("%s: %s want %s", tc.key, got, tc.want)
		}
	}
}

func TestPurposeMigrationPreservesIdentityAndAvailability(t *testing.T) {
	db := testdb.Open(t, 52)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, device := uuid.New(), uuid.New()
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'gateway','gateway')`, device)
	must(`INSERT INTO data_sources(id,name,type,dsn_secret_ref,created_by) VALUES($1,'v2','http_api','env:UNUSED',$2)`, source, admin)
	type saved struct {
		id, binding  uuid.UUID
		status, want string
	}
	rows := []saved{}
	for i, tc := range []struct {
		metric       string
		node         *int
		status, want string
	}{
		{"cell", nil, "disabled", "status"}, {"latitude", nil, "archived", "location"}, {"temperature", nil, "active", "status"},
		{"battery", new(1), "active", "status"}, {"temp", new(1), "active", "measurement"},
	} {
		id, binding := uuid.New(), uuid.New()
		cfg, _ := json.Marshal(loraWANV2TelemetryConfig{GatewaySN: "TEST", NodeIndex: tc.node, Metric: tc.metric})
		must(`INSERT INTO data_streams(id,device_id,code,name,type,status,created_by,created_by_type) VALUES($1,$2,$3,$3,'telemetry',$4,$5,'system_admin')`, id, device, string(rune('a'+i)), tc.status, admin)
		must(`INSERT INTO data_stream_bindings(id,data_stream_id,data_source_id,adapter_code,payload_type,adapter_config_json,created_by,created_by_type) VALUES($1,$2,$3,'lorawan_v2','json',$4,$5,'system_admin')`, binding, id, source, cfg, admin)
		rows = append(rows, saved{id, binding, tc.status, tc.want})
	}
	check := func() {
		t.Helper()
		for _, r := range rows {
			var purpose, status string
			var binding uuid.UUID
			if err := db.QueryRow(ctx, `SELECT ds.purpose,ds.status,b.id FROM data_streams ds JOIN data_stream_bindings b ON b.data_stream_id=ds.id WHERE ds.id=$1`, r.id).Scan(&purpose, &status, &binding); err != nil {
				t.Fatal(err)
			}
			if purpose != r.want || status != r.status || binding != r.binding {
				t.Fatalf("changed history identity/status: %s %s %s", purpose, status, binding)
			}
		}
	}
	testdb.Apply(t, db, "../../../../migrations/000053_stream_purpose.up.sql")
	check()
	testdb.Apply(t, db, "../../../../migrations/000053_stream_purpose.down.sql")
	testdb.Apply(t, db, "../../../../migrations/000053_stream_purpose.up.sql")
	check()
}

func TestSyncMaintainsPurposeAndStableIDs(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	var sourceID uuid.UUID
	if err := db.QueryRow(ctx, `INSERT INTO data_sources(name,type,dsn_secret_ref,created_by) VALUES('v2','http_api','env:UNUSED',$1) RETURNING id`, admin).Scan(&sourceID); err != nil {
		t.Fatal(err)
	}
	service := newTestService(db)
	gateway := LoRaWANV2Gateway{SN: "PURPOSE-TEST", NodeCount: 1}
	index := 1
	specs := []loraWANV2StreamSpec{}
	for _, tc := range []struct {
		node *int
		key  string
	}{{nil, "cell"}, {nil, "altitude"}, {&index, "battery"}, {&index, "temp"}} {
		cfg, _ := json.Marshal(loraWANV2TelemetryConfig{GatewaySN: gateway.SN, NodeIndex: tc.node, Metric: tc.key})
		prefix := "gateway"
		if tc.node != nil {
			prefix = "node_1"
		}
		specs = append(specs, loraWANV2StreamSpec{Code: loraWANV2StreamCode(prefix, tc.key), Name: tc.key, AdapterConfig: cfg})
	}
	first, err := service.persistLoRaWANV2Gateway(ctx, sqlc.DataSource{ID: sourceID}, gateway, specs, true, admin)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.persistLoRaWANV2Gateway(ctx, sqlc.DataSource{ID: sourceID}, gateway, specs, true, admin)
	if err != nil {
		t.Fatal(err)
	}
	if first.Device.ID != second.Device.ID || len(second.DataStreams) != 4 {
		t.Fatal("sync replaced identity or duplicated channels")
	}
	for i, stream := range second.DataStreams {
		if stream.ID != first.DataStreams[i].ID || stream.Purpose == "" {
			t.Fatalf("unstable stream %+v", stream)
		}
	}
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM data_streams WHERE device_id=$1 AND purpose='measurement'`, first.Device.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("measurement count %d: %v", count, err)
	}
}
