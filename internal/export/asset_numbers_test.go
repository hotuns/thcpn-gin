package export

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"path"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/testdb"
)

func TestArchivesUsePlatformAssetNumbers(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	first, second, source := uuid.New(), uuid.New(), uuid.New()
	temperature, camera, photo := uuid.New(), uuid.New(), uuid.New()
	start := time.Date(2026, 11, 7, 0, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO devices(id,name,serial_no,device_type,asset_no) VALUES
		($1,'同名标准站','OLD-SN-1','standalone','ZC-71000001'),($2,'同名标准站','OLD-SN-2','standalone','ZC-71000002')`, first, second)
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by)
		VALUES($1,'test source','mysql','thcpn','env:UNUSED',$2)`, source, admin)
	must(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES
		($1,$2,'temp','温度','telemetry',$5,'system_admin'),($3,$2,'camera','近景','image',$5,'system_admin'),
		($4,$6,'temp','温度','telemetry',$5,'system_admin')`, temperature, first, camera, uuid.New(), admin, second)
	must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,payload_type,adapter_code,created_by,created_by_type)
		SELECT id,$1,'json','thcpn_legacy_mysql',$2,'system_admin' FROM data_streams WHERE device_id IN ($3,$4)`, source, admin, first, second)
	store := objectstore.NewStore(config.ObjectStoreConfig{Provider: "file", LocalPath: t.TempDir(), Bucket: "test"})
	objectKey := "raw/" + photo.String() + ".jpg"
	if err := store.Put(ctx, objectstore.PutInput{ObjectKey: objectKey, Body: strings.NewReader("jpeg")}); err != nil {
		t.Fatal(err)
	}
	runtime := segmentedRuntime{
		telemetry: func(q platform.TelemetryQuery) (platform.TelemetryResult, error) {
			return platform.TelemetryResult{Complete: true, Points: []platform.TelemetryPoint{{Timestamp: q.Start, Value: 12.5}}}, nil
		},
		media: func(q platform.MediaQuery) (platform.MediaResult, error) {
			return platform.MediaResult{Total: 1, Items: []platform.MediaRecord{{ID: photo.String(), ObjectKey: objectKey, CapturedAt: q.Start, MediaType: "image"}}}, nil
		},
	}
	p := NewProcessor(db, nil, runtime, store, config.ExportConfig{}, nil)
	open := func(t *testing.T, job Job) *zip.Reader {
		t.Helper()
		var output bytes.Buffer
		if _, err := p.render(ctx, job, &output); err != nil {
			t.Fatal(err)
		}
		archive, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range archive.File {
			entry := file.Name + "\n" + readZipFile(t, archive, file.Name)
			for _, id := range []uuid.UUID{first, second, temperature, camera, photo} {
				if strings.Contains(entry, id.String()) {
					t.Fatalf("internal ID found in archive entry %s: %s", file.Name, entry)
				}
			}
		}
		return archive
	}
	assertEntry := func(t *testing.T, archive *zip.Reader, file, want string) {
		t.Helper()
		if got := readZipFile(t, archive, file); !strings.Contains(got, want) {
			t.Fatalf("%s = %q; want %q", file, got, want)
		}
	}

	t.Run("standard station package and filename", func(t *testing.T) {
		raw, _ := json.Marshal(batchExportConfig{DeviceIDs: []string{first.String(), second.String()}, StartTime: start, EndTime: end, IncludeData: true, IncludeImages: true})
		job := Job{ID: uuid.New(), RequestedByAdmin: &admin, ResourceID: first, ResourceType: "device_batch", ExportType: "standard_station_zip", RequestConfig: raw, CreatedAt: start}
		key, err := p.exportObjectKey(ctx, job, "zip")
		if err != nil || path.Base(key) != "ZC-71000001_2-devices_20261107-080000.zip" {
			t.Fatalf("wrong download name: %q, %v", key, err)
		}
		archive := open(t, job)
		assertEntry(t, archive, "manifest.csv", "ZC-71000001,同名标准站,standalone,ZC-71000001")
		assertEntry(t, archive, "manifest.csv", "ZC-71000002,同名标准站,standalone,ZC-71000002")
		assertEntry(t, archive, "ZC-71000002/data.csv", "2026-11-07 08:00:00,12.5,ZC-71000002")
		assertEntry(t, archive, "ZC-71000001/image-index.csv", "ZC-71000001,camera,近景,image,2026-11-07 08:00:00,ZC-71000001/近景/2026-11-07_08-00-00.jpg")
		assertEntry(t, archive, "generation-report.csv", "ZC-71000001,telemetry")
	})
	t.Run("dataset and media package", func(t *testing.T) {
		user, workspace, dataset := uuid.New(), uuid.New(), uuid.New()
		must(`INSERT INTO users(id,name,email) VALUES($1,'Archive test','archive@example.test')`, user)
		must(`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','test',$2)`, workspace, user)
		must(`INSERT INTO datasets(id,workspace_id,name,data_type,time_start,time_end,created_by)
			VALUES($1,$2,'样地数据集','mixed',$3,$4,$5)`, dataset, workspace, start, end, user)
		must(`INSERT INTO dataset_sources(dataset_id,source_type,source_id) VALUES($1,'device',$2),($1,'data_stream',$3)`, dataset, first, temperature)
		archive := open(t, Job{ResourceID: dataset, ResourceType: "dataset", ExportType: "dataset_zip"})
		assertEntry(t, archive, "sources.csv", "data_stream,ZC-71000001,同名标准站,temp,telemetry/ZC-71000001/stream-temp.csv")
		assertEntry(t, archive, "telemetry/ZC-71000001/data.csv", "同名标准站,ZC-71000001")
		assertEntry(t, archive, "media/manifest.csv", "ZC-71000001,camera,近景")
		raw, _ := json.Marshal(requestConfig{StartTime: start, EndTime: end})
		archive = open(t, Job{ResourceID: camera, ResourceType: "data_stream", ExportType: "media_zip", RequestConfig: raw})
		assertEntry(t, archive, "manifest.csv", "ZC-71000001/近景/2026-11-07_08-00-00.jpg")
	})
}
