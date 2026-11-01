package carbon

import (
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestFirmwareRegistrationWritesVersionBuildAndObjectKey(t *testing.T) {
	mysqlDB, dsn := testdb.MySQL(t, carbonDatabaseName)
	if _, err := mysqlDB.ExecContext(t.Context(), `CREATE TABLE firmwares(id BIGINT PRIMARY KEY AUTO_INCREMENT,device_id BIGINT NOT NULL,version VARCHAR(128) NOT NULL,build_id BIGINT NOT NULL,path TEXT,created_at DATETIME,updated_at DATETIME)`); err != nil {
		t.Fatal(err)
	}
	pg := testdb.Open(t, 0)
	actor := testdb.Admin(t, pg)
	source := uuid.New()
	t.Setenv("TEST_CARBON_FIRMWARE_DSN", dsn)
	if _, err := pg.Exec(t.Context(), `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon','mysql','carbon','env:TEST_CARBON_FIRMWARE_DSN',$2)`, source, actor); err != nil {
		t.Fatal(err)
	}
	svc := newTestService(pg)
	build := int64(7)
	input := platform.SourceFirmwareInput{DataSourceID: source, ExternalDeviceID: 31, Version: "2.3.4", BuildID: &build, ObjectKey: "carbon/firmware.bin", PublicURL: "https://thcpn.example.test/not-carbon.bin"}
	id, err := svc.RegisterFirmware(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if id <= 0 {
		t.Fatal("registration did not return a source firmware ID")
	}
	var device, gotBuild int64
	var version, path string
	if err = mysqlDB.QueryRowContext(t.Context(), "SELECT device_id,version,build_id,path FROM firmwares WHERE id=?", id).Scan(&device, &version, &gotBuild, &path); err != nil {
		t.Fatal(err)
	}
	if device != 31 || gotBuild != build || version != input.Version || path != input.ObjectKey {
		t.Fatal("firmware values written to incorrect source columns")
	}
	input.BuildID = nil
	if _, err = svc.RegisterFirmware(t.Context(), input); err == nil {
		t.Fatal("missing Carbon build ID accepted")
	}
	var count int
	if err = mysqlDB.QueryRowContext(t.Context(), "SELECT count(*) FROM firmwares").Scan(&count); err != nil || count != 1 {
		t.Fatal("failed registration created a source record")
	}
}
