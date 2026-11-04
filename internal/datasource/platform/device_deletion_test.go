package platform

import (
	"github.com/google/uuid"
	"strings"
	"testing"
	"thcpn-gin/internal/testdb"
)

func TestManagedSourceDeletionKeepsHistoryAndStopsDiscovery(t *testing.T) {
	db, _ := testdb.MySQL(t, "delete_test_"+strings.ReplaceAll(uuid.NewString(), "-", ""))
	ctx := t.Context()
	exec := func(stmt string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, stmt, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE devices(id BIGINT PRIMARY KEY, sn VARCHAR(64), deleted_at TIMESTAMP NULL)")
	exec("CREATE TABLE device_config(device_id BIGINT, data JSON, image JSON, control JSON, deleted_at TIMESTAMP NULL, is_mg INT, updated_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
	exec("CREATE TABLE device_data_202601(device_id BIGINT)")
	exec("CREATE TABLE device_user(device_id BIGINT, deleted_at TIMESTAMP NULL)")
	exec("INSERT INTO devices(id,sn) VALUES(1,?),(2,?),(3,'legacy'),(4,?)", CreatedSourceDeviceSN("thcreate.v1.", 1), CreatedSourceDeviceSN("thcreate.v1.", 2), CreatedSourceDeviceSN("thcreate.v1.", 4))
	exec("INSERT INTO device_config(device_id,data,image,control,is_mg,updated_at) VALUES(1,'[]','[]','{}',0,CURRENT_TIMESTAMP)")
	exec("INSERT INTO device_data_202601 VALUES(2)")
	exec("INSERT INTO device_user VALUES(4,CURRENT_TIMESTAMP)")
	for id, want := range map[int64]string{1: "deleted", 2: "blocked", 3: "blocked", 4: "blocked"} {
		got, err := CheckManagedMySQLDeletion(ctx, db, id, "thcreate.v1.", "device_config", "is_mg=0 AND (updated_at IS NULL OR updated_at=created_at)", "^device_data_[0-9]+$", [][2]string{{"device_user", "device_id"}}, true)
		if err != nil || got.State != want {
			t.Fatalf("%d: %+v %v", id, got, err)
		}
	}
	var active int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM devices WHERE deleted_at IS NULL").Scan(&active); err != nil || active != 3 {
		t.Fatalf("source discovery: %d %v", active, err)
	}
	var config int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM device_config").Scan(&config); err != nil || config != 1 {
		t.Fatalf("source config was removed: %d %v", config, err)
	}
}
