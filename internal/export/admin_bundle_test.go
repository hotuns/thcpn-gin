package export

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"path"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/testdb"
)

func TestAdminMultiGatewayExportQueuesOneJobAndDownloadsBoth(t *testing.T) {
	db := testdb.Open(t, 59)
	testdb.Apply(t, db, "../../migrations/000060_admin_device_bundle_exports.up.sql")
	testdb.Apply(t, db, "../../migrations/000060_admin_device_bundle_exports.down.sql")
	testdb.Apply(t, db, "../../migrations/000060_admin_device_bundle_exports.up.sql")
	ctx := t.Context()
	admin, source := testdb.Admin(t, db), uuid.New()
	gateways := []uuid.UUID{uuid.New(), uuid.New()}
	nodes := []uuid.UUID{uuid.New(), uuid.New()}
	streams := []uuid.UUID{uuid.New(), uuid.New()}
	assetNos := []string{"LR-81000001", "LR-81000002"}
	names := []string{"网关甲", "网关乙"}
	nodeNames := []string{"东侧节点", "西侧节点"}
	start := time.Date(2026, 11, 17, 2, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by)
		VALUES($1,'THCPN','mysql','thcpn','env:UNUSED',$2)`, source, admin)
	parts := make([]adminBundlePart, len(gateways))
	for i, gw := range gateways {
		node := nodes[i]
		must(`INSERT INTO devices(id,name,device_type,asset_no) VALUES($1,$2,'gateway',$3),($4,$5,'gateway_node',NULL)`, gw, names[i], assetNos[i], node, nodeNames[i])
		must(`INSERT INTO device_relations(parent_device_id,child_device_id,relation_type,data_source_id,external_parent_device_id,external_child_device_id)
			VALUES($1,$2,'gateway_node',$3,$4,$5)`, gw, node, source, 100+i, 200+i)
		must(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type)
			VALUES($1,$2,'temp','温度','telemetry',$3,'system_admin')`, streams[i], node, admin)
		must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,payload_type,adapter_code,created_by,created_by_type)
			VALUES($1,$2,'json','thcpn_legacy_mysql',$3,'system_admin')`, streams[i], source, admin)
		raw, err := json.Marshal(batchExportConfig{GatewayID: gw.String(), GatewayName: names[i], DeviceIDs: []string{node.String()},
			NodeTargets: []device.NodeTarget{{Kind: "device", DeviceID: &node}}, IncludeData: true, StartTime: start.Add(-time.Hour), EndTime: start})
		if err != nil {
			t.Fatal(err)
		}
		parts[i] = adminBundlePart{ResourceType: "device_batch", ResourceID: node, ExportType: "group_site_zip", RequestConfig: raw}
	}
	svc := NewService(db, nil, config.ExportConfig{})
	create := func(parts []adminBundlePart) (Job, error) {
		t.Helper()
		raw, err := json.Marshal(adminBundleConfig{StartTime: start, EndTime: end, DeviceIDs: []uuid.UUID{uuid.New()}, Parts: parts})
		if err != nil {
			t.Fatal(err)
		}
		return svc.CreateAdmin(ctx, admin, CreateInput{ResourceType: "device_batch", ResourceID: gateways[0], ExportType: adminDeviceBundleZIP, RequestConfig: raw})
	}
	invalid := append([]adminBundlePart(nil), parts...)
	invalid[1].ResourceID = nodes[0]
	if _, err := create(invalid); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("second gateway accepts the first gateway's node anchor: %v", err)
	}
	job, err := create(parts)
	if err != nil {
		t.Fatal(err)
	}
	var saved adminBundleConfig
	if err = json.Unmarshal(job.RequestConfig, &saved); err != nil || !slices.Equal(saved.DeviceIDs, gateways) || job.RequestedByAdmin == nil || *job.RequestedByAdmin != admin {
		t.Fatalf("wrong bundle membership or ownership: %v", err)
	}
	for _, gw := range gateways {
		rows, err := svc.queries.ListAdminExportJobs(ctx, sqlc.ListAdminExportJobsParams{DeviceID: &gw, MaxJobs: 20})
		if err != nil || len(rows) != 1 || rows[0].ID != job.ID {
			t.Fatalf("gateway must link to the same job: %v", err)
		}
	}
	var count int
	if err = db.QueryRow(ctx, `SELECT count(*) FROM export_jobs`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("expected only one persisted job, got %d: %v", count, err)
	}
	if _, _, err = resolveAction("device_batch", adminDeviceBundleZIP); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatal("user exports must not accept the admin bundle format")
	}
	store := objectstore.NewStore(config.ObjectStoreConfig{Provider: "file", LocalPath: t.TempDir(), Bucket: "test"})
	runtime := segmentedRuntime{telemetry: func(q platform.TelemetryQuery) (platform.TelemetryResult, error) {
		if !q.Start.Equal(start) || !q.End.Equal(end) || !slices.Contains(streams, q.Binding.DataStreamID) {
			t.Fatalf("wrong device or time range in worker query: %+v", q)
		}
		return platform.TelemetryResult{Complete: true, Points: []platform.TelemetryPoint{{Timestamp: q.Start, Value: 12.3}}}, nil
	}}
	worker := NewProcessor(db, nil, runtime, store, config.ExportConfig{TempDir: t.TempDir()}, nil)
	if processed, err := worker.ProcessJob(ctx, job.ID); err != nil || !processed {
		t.Fatalf("process bundled job: %t, %v", processed, err)
	}
	finished, err := svc.Get(ctx, job.ID)
	if err != nil || finished.Status != "success" || finished.FileObjectKey == nil || !strings.HasPrefix(path.Base(*finished.FileObjectKey), "LR-81000001_2-devices_") {
		t.Fatalf("unexpected bundle result: %+v, %v", finished, err)
	}
	file, err := store.Get(ctx, *finished.FileObjectKey)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Body.Close()
	body, err := io.ReadAll(file.Body)
	if err != nil {
		t.Fatal(err)
	}
	outer, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	manifest := readZipFile(t, outer, "devices.csv")
	for i, assetNo := range assetNos {
		entry := assetNo + "/" + assetNo + ".zip"
		if !strings.Contains(manifest, assetNo+","+names[i]+","+entry) {
			t.Fatalf("device missing from manifest: %s", manifest)
		}
		nested := readZipFile(t, outer, entry)
		inner, err := zip.NewReader(strings.NewReader(nested), int64(len(nested)))
		if err != nil || !strings.Contains(readZipFile(t, inner, "data.csv"), nodeNames[i]) {
			t.Fatalf("gateway %s lost selected node in the archive: %v", assetNo, err)
		}
	}

	for i, gw := range gateways {
		parts[i] = adminBundlePart{ResourceType: "device", ResourceID: gw, ExportType: "telemetry_excel", RequestConfig: json.RawMessage(`{}`)}
	}
	excelJob, err := create(parts)
	if err != nil {
		t.Fatal(err)
	}
	var excelOutput bytes.Buffer
	if result, err := worker.render(ctx, excelJob, &excelOutput); err != nil || result.Extension != "zip" {
		t.Fatalf("render multi-device Excel: %+v, %v", result, err)
	}
	excelArchive, err := zip.NewReader(bytes.NewReader(excelOutput.Bytes()), int64(excelOutput.Len()))
	if err != nil {
		t.Fatal(err)
	}
	for i, assetNo := range assetNos {
		entry := readZipFile(t, excelArchive, assetNo+"/"+assetNo+".xlsx")
		book, err := zip.NewReader(strings.NewReader(entry), int64(len(entry)))
		if err != nil || !strings.Contains(readZipFile(t, book, "xl/worksheets/sheet1.xml"), nodeNames[i]) {
			t.Fatalf("gateway %s missing from its workbook: %v", assetNo, err)
		}
	}
}
