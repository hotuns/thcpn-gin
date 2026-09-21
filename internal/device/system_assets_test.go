package device

import (
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/testdb"
)

func TestListSystemAssetsIncludesFirmwareSourceFamily(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	sourceID, deviceID := uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon','mysql','carbon','env:TEST',$2)`, []any{sourceID, admin}},
		{`INSERT INTO devices(id,name,serial_no,device_type,status) VALUES($1,'Carbon device','C-17','carbon_sink','active')`, []any{deviceID}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'carbon_sink_mysql','17')`, []any{deviceID, sourceID}},
		{`INSERT INTO device_capabilities(device_id,capability_code) VALUES($1,'firmware_update')`, []any{deviceID}},
	} {
		if _, err := db.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}

	items, err := NewService(db).ListSystemAssets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].SourceFamily != "carbon" || items[0].ExternalKey != "17" || !hasCapability(items[0].Capabilities, "firmware_update") {
		t.Fatalf("unexpected system asset: %#v", items)
	}
}
