package export

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/config"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestBatchExportReadFailurePersistsFailedAndNeverUploads(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	user, workspace, deviceID, source := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	admin := testdb.Admin(t, db)
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO users(id,name,email) VALUES($1,'Export read test','segmented@test.invalid')`, user)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','test',$2)`, workspace, user)
	must(`INSERT INTO workspace_members(workspace_id,user_id,role_id,scope_id,template_code) SELECT $1,$2,id,$1,'owner' FROM roles WHERE code='owner' AND workspace_id IS NULL LIMIT 1`, workspace, user)
	must(`INSERT INTO workspace_member_permissions(member_id,permission_id) SELECT wm.id,rp.permission_id FROM workspace_members wm JOIN role_permissions rp ON rp.role_id=wm.role_id WHERE wm.workspace_id=$1`, workspace)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'test station','standalone')`, deviceID)
	must(`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, deviceID, workspace)
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'test source','mysql','thcpn','env:NOT_USED',$2)`, source, admin)
	for _, typ := range []string{"telemetry", "image"} {
		stream := uuid.New()
		must(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,$3,$3,$3,$4,'system_admin')`, stream, deviceID, typ, admin)
		must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,payload_type,adapter_code,created_by,created_by_type) VALUES($1,$2,'json','thcpn_legacy_mysql',$3,'system_admin')`, stream, source, admin)
	}
	start := time.Date(2025, 7, 29, 16, 0, 0, 0, time.UTC)
	end := time.Date(2026, 10, 27, 6, 3, 0, 0, time.UTC)
	cfg := batchExportConfig{DeviceIDs: []string{deviceID.String()}, StartTime: start, EndTime: end, IncludeData: true, IncludeImages: true}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	for _, failed := range []bool{true, false} {
		t.Run(map[bool]string{true: "failed reads", false: "successful long reads"}[failed], func(t *testing.T) {
			id := uuid.New()
			must(`INSERT INTO export_jobs(id,workspace_id,requested_by,resource_type,resource_id,export_type,expires_at,request_config_json) VALUES($1,$2,$3,'device_batch',$4,'standard_station_zip',now()+interval '1 day',$5)`, id, workspace, user, deviceID, raw)
			calls := 0
			rt := segmentedRuntime{telemetry: func(q platform.TelemetryQuery) (platform.TelemetryResult, error) {
				calls++
				if failed {
					return platform.TelemetryResult{}, errors.New("source unavailable")
				}
				if q.End.Sub(q.Start) > exportQueryWindow {
					t.Fatal("unsegmented read")
				}
				return platform.TelemetryResult{Complete: true, Points: []platform.TelemetryPoint{{Timestamp: q.Start, Value: 1}}}, nil
			}, media: func(q platform.MediaQuery) (platform.MediaResult, error) {
				if failed {
					return platform.MediaResult{}, errors.New("source unavailable")
				}
				return platform.MediaResult{}, nil
			}}
			store := &diskInputStore{t: t}
			p := NewProcessor(db, nil, rt, store, config.ExportConfig{TempDir: t.TempDir()}, nil)
			processed, err := p.ProcessJob(ctx, id)
			if !processed || (err != nil) != failed {
				t.Fatalf("processed=%v err=%v", processed, err)
			}
			row, err := p.queries.GetExportJob(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			if failed {
				if row.Status != "failed" || row.FileObjectKey != nil || store.size != 0 || row.ErrorMessage == nil || !strings.Contains(*row.ErrorMessage, "未生成任何数据或图片") {
					t.Fatalf("bad failure status: %+v upload bytes=%d", row, store.size)
				}
			} else if row.Status != "success" || store.size == 0 || calls < 15 {
				t.Fatalf("bad success status=%s calls=%d bytes=%d", row.Status, calls, store.size)
			}
		})
	}
}
