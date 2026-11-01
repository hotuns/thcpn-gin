package thcpn

import (
	"github.com/google/uuid"
	"strings"
	"testing"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestFirmwareRegistrationWritesVersionAndPublicURL(t *testing.T) {
	mysqlDB, dsn := testdb.MySQL(t, "thcpn_firmware_"+strings.ReplaceAll(uuid.NewString(), "-", ""))
	_, err := mysqlDB.ExecContext(t.Context(), `CREATE TABLE device_firmwares(id BIGINT PRIMARY KEY AUTO_INCREMENT,device_type INT NULL,device_id JSON NOT NULL,build BIGINT NULL,version VARCHAR(128) NOT NULL,uri TEXT,path TEXT,algorithm VARCHAR(20),hashvalue VARCHAR(128),created_at DATETIME,updated_at DATETIME)`)
	if err != nil {
		t.Fatal(err)
	}
	pg := testdb.Open(t, 0)
	actor := testdb.Admin(t, pg)
	source := uuid.New()
	t.Setenv("TEST_THCPN_FIRMWARE_DSN", dsn)
	if _, err = pg.Exec(t.Context(), `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'THCPN','mysql','thcpn','env:TEST_THCPN_FIRMWARE_DSN',$2)`, source, actor); err != nil {
		t.Fatal(err)
	}
	svc := newTestService(pg)
	input := platform.SourceFirmwareInput{DataSourceID: source, ExternalDeviceID: 42, Version: "1.2.3", PublicURL: "https://thcpn.example.test/firmware.bin", ObjectKey: "unused-carbon-path", VerifyValue: "0123456789abcdef0123456789abcdef"}
	id, err := svc.RegisterFirmware(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if id <= 0 {
		t.Fatal("registration did not return a source firmware ID")
	}
	var device, version, uri, algorithm, hash string
	var nullablePath *string
	if err = mysqlDB.QueryRowContext(t.Context(), "SELECT device_id,version,uri,path,algorithm,hashvalue FROM device_firmwares WHERE id=?", id).Scan(&device, &version, &uri, &nullablePath, &algorithm, &hash); err != nil {
		t.Fatal(err)
	}
	if device != "[42]" || version != input.Version || uri != input.PublicURL || nullablePath != nil || algorithm != "MD5" || hash != input.VerifyValue {
		t.Fatal("firmware values written to incorrect source columns")
	}
}
