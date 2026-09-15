package db_test

import (
	"github.com/google/uuid"
	"os"
	"strings"
	"testing"
	"thcpn-gin/internal/testdb"
)

func TestUnifiedSourceMigrationPreservesKeysAndRejectsAmbiguity(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		t.Run(map[bool]string{false: "roundtrip", true: "conflict"}[conflict], func(t *testing.T) {
			db := testdb.Open(t, 31)
			ctx := t.Context()
			admin := testdb.Admin(t, db)
			numericSource, loraSource, numericDevice, loraDevice, refID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
			must := func(sql string, args ...any) {
				t.Helper()
				if _, err := db.Exec(ctx, sql, args...); err != nil {
					t.Fatal(err)
				}
			}
			must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES ($1,'Numeric','mysql','thcpn','env:UNUSED',$3),($2,'LoRa','http_api','lorawan_v2','env:UNUSED',$3)`, numericSource, loraSource, admin)
			must(`INSERT INTO devices(id,name,device_type) VALUES ($1,'Station','standalone'),($2,'Gateway','gateway')`, numericDevice, loraDevice)
			must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_device_id) VALUES ($1,$2,'thcpn_legacy_mysql',9223372036854775807)`, numericDevice, numericSource)
			must(`INSERT INTO lorawan_v2_device_refs(id,device_id,data_source_id,gateway_sn) VALUES ($1,$2,$3,'001-SN')`, refID, loraDevice, loraSource)
			if conflict {
				must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_device_id) VALUES ($1,$2,'thcpn_legacy_mysql',42)`, loraDevice, numericSource)
			}
			up, err := os.ReadFile("../../migrations/000032_unified_device_sources.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			tx, err := db.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			_, err = tx.Exec(ctx, string(up))
			if conflict {
				_ = tx.Rollback(ctx)
				if err == nil || !strings.Contains(err.Error(), loraDevice.String()) {
					t.Fatalf("expected device-specific conflict: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err = tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			var key string
			var actual uuid.UUID
			if err := db.QueryRow(ctx, `SELECT id,external_key FROM device_source_refs WHERE device_id=$1`, loraDevice).Scan(&actual, &key); err != nil || actual != refID || key != "001-SN" {
				t.Fatalf("identity changed %s %s %v", actual, key, err)
			}
			if err := db.QueryRow(ctx, `SELECT external_key FROM device_source_refs WHERE device_id=$1`, numericDevice).Scan(&key); err != nil || key != "9223372036854775807" {
				t.Fatalf("numeric key changed %s %v", key, err)
			}
			down, err := os.ReadFile("../../migrations/000032_unified_device_sources.down.sql")
			if err != nil {
				t.Fatal(err)
			}
			must(string(down))
			if err := db.QueryRow(ctx, `SELECT id,gateway_sn FROM lorawan_v2_device_refs WHERE device_id=$1`, loraDevice).Scan(&actual, &key); err != nil || actual != refID || key != "001-SN" {
				t.Fatalf("rollback changed identity: %v", err)
			}
			must(string(up))
		})
	}
}
