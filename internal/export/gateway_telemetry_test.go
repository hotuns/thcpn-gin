package export

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/config"
	platform "thcpn-gin/internal/datasource/platform"
	telemetrysvc "thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/testdb"
)

func TestGatewayExcelReadsChildStreamsWhenGatewayHasNone(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	gateway, child, stream, source := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'test','mysql','thcpn','env:UNUSED',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'长白山示范网关','gateway'),($2,'红松','gateway_node')`, gateway, child)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'thcpn_legacy_mysql','2609')`, gateway, source)
	must(`INSERT INTO device_relations(parent_device_id,child_device_id,relation_type,data_source_id,external_parent_device_id,external_child_device_id) VALUES($1,$2,'gateway_node',$3,'2609','2610')`, gateway, child, source)
	must(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,'temp','温度','telemetry',$3,'system_admin')`, stream, child, admin)
	must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,payload_type,adapter_code,created_by,created_by_type) VALUES($1,$2,'json','thcpn_legacy_mysql',$3,'system_admin')`, stream, source, admin)
	rt := segmentedRuntime{telemetry: func(q platform.TelemetryQuery) (platform.TelemetryResult, error) {
		if q.Binding.DataStreamID != stream {
			t.Fatalf("wrong stream: %s", q.Binding.DataStreamID)
		}
		return platform.TelemetryResult{Complete: true, Points: []platform.TelemetryPoint{{Timestamp: q.Start, Value: 12.3}}}, nil
	}}
	p := NewProcessor(db, nil, rt, &exportTestStore{}, config.ExportConfig{}, nil)
	p.telemetry = telemetrysvc.NewService(db, nil, rt, config.QueryLimitsConfig{})
	start := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	series, err := p.queryTelemetry(ctx, "device", gateway, start, start.Add(time.Hour), 1000)
	if err != nil || len(series) != 1 || len(series[0].Points) != 1 {
		t.Fatalf("gateway export lost child data: %+v %v", series, err)
	}
	if series[0].DeviceID != child || series[0].Name != "红松 · 温度" {
		t.Fatalf("node identity lost: %+v", series[0])
	}

	must(`UPDATE data_streams SET status='disabled' WHERE id=$1`, stream)
	if _, err := p.queryTelemetry(ctx, "device", gateway, start, start.Add(time.Hour), 1000); err == nil {
		t.Fatal("gateway without exportable metrics must fail instead of producing an empty spreadsheet")
	}
}
