package demoshowcase

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/testdb"
)

func TestDeviceSelectionSearchesPlatformAssetNumbers(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	user, workspace, device := uuid.New(), uuid.New(), uuid.New()
	const assetNo = "ZC-84000001"
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO users(id,name,username,is_demo) VALUES($1,'Demo account','inventory-demo',true)`, user)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id,is_demo_workspace)
		VALUES($1,'personal','Demo workspace',$2,true)`, workspace, user)
	must(`INSERT INTO devices(id,name,serial_no,asset_no,device_type)
		VALUES($1,'Field station','OLD-DEVICE-NUMBER',$2,'standalone')`, device, assetNo)

	items, total, err := NewService(db).ListDevices(ctx, user, strings.ToLower(assetNo), 20, 0)
	if err != nil || total != 1 || len(items) != 1 || items[0].ID != device || items[0].AssetNo != assetNo {
		t.Fatalf("asset search: %#v total=%d err=%v", items, total, err)
	}
	encoded, err := json.Marshal(items[0])
	if err != nil || strings.Contains(string(encoded), "serial_no") || strings.Contains(string(encoded), "OLD-DEVICE-NUMBER") {
		t.Fatalf("demo device exposes legacy identity: %s %v", encoded, err)
	}
}
