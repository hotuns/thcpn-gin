package platform

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/testdb"
)

func TestDemoHistoryUsesShowcaseWorkspace(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	demo, owner, demoWorkspace, realWorkspace, device := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO users(id,name,username,is_demo) VALUES($1,'Demo','history-demo',true)`, demo)
	must(`INSERT INTO users(id,name,email) VALUES($1,'Owner','history-owner@example.test')`, owner)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id,is_demo_workspace) VALUES($1,'personal','Demo',$2,true),($3,'personal','Real',$4,false)`, demoWorkspace, demo, realWorkspace, owner)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Selected station','carbon_sink')`, device)
	must(`INSERT INTO demo_showcase_devices(user_id,workspace_id,device_id,added_by) VALUES($1,$2,$3,$4)`, demo, demoWorkspace, device, admin)
	svc := NewService(db)
	svc.SetBilling(billing.NewService(db, billing.Policy{BaseHistoryDays: 90}))
	demoCtx := auth.WithActor(ctx, auth.Actor{UserID: demo, IsDemo: true})
	oldStart := time.Now().UTC().AddDate(0, 0, -120)
	if err := svc.ValidateDeviceHistory(demoCtx, device, oldStart); err != nil {
		t.Fatalf("selected unassigned demo history: %v", err)
	}
	must(`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, device, realWorkspace)
	if err := svc.ValidateDeviceHistory(demoCtx, device, oldStart); err != nil {
		t.Fatalf("real base-plan assignment restricted demo history: %v", err)
	}
	if err := svc.ValidateDeviceHistory(auth.WithActor(ctx, auth.Actor{UserID: owner}), device, oldStart); apperr.KindOf(err) != apperr.KindPermissionDenied {
		t.Fatalf("ordinary owner should retain base-plan history window: %v", err)
	}
	must(`DELETE FROM demo_showcase_devices WHERE device_id=$1`, device)
	if err := svc.ValidateDeviceHistory(demoCtx, device, oldStart); apperr.KindOf(err) != apperr.KindPermissionDenied {
		t.Fatalf("removed demo reference should deny history: %v", err)
	}
}
