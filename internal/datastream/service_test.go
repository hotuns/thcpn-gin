package datastream

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/testdb"
)

func TestWorkspaceForDeviceUsesDemoSelectionAndOrdinaryAssignment(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	demo, user, demoWorkspace, realWorkspace, device := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO users(id,name,username,is_demo) VALUES($1,'Demo','stream-demo',true)`, demo)
	must(`INSERT INTO users(id,name,email) VALUES($1,'Owner','stream-owner@example.test')`, user)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id,is_demo_workspace) VALUES($1,'personal','Demo',$2,true),($3,'personal','Real',$4,false)`, demoWorkspace, demo, realWorkspace, user)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Selected station','standalone')`, device)
	must(`INSERT INTO demo_showcase_devices(user_id,workspace_id,device_id,added_by) VALUES($1,$2,$3,$4)`, demo, demoWorkspace, device, admin)
	svc := NewService(db)
	demoCtx := auth.WithActor(ctx, auth.Actor{UserID: demo, IsDemo: true})
	userCtx := auth.WithActor(ctx, auth.Actor{UserID: user})
	for _, assigned := range []bool{false, true} {
		if assigned {
			must(`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, device, realWorkspace)
		}
		if workspace, err := svc.WorkspaceForDevice(demoCtx, device); err != nil || workspace != demoWorkspace {
			t.Fatalf("demo workspace: %s %v", workspace, err)
		}
		workspace, err := svc.WorkspaceForDevice(userCtx, device)
		if (!assigned && apperr.KindOf(err) != apperr.KindNotFound) || (assigned && (err != nil || workspace != realWorkspace)) {
			t.Fatalf("ordinary workspace: %s %v", workspace, err)
		}
	}
	must(`DELETE FROM demo_showcase_devices WHERE device_id=$1`, device)
	if _, err := svc.WorkspaceForDevice(demoCtx, device); apperr.KindOf(err) != apperr.KindPermissionDenied {
		t.Fatalf("unselected device must remain denied: %v", err)
	}
}

func TestComputedDataStreamListUsesOwningDataStreamDevice(t *testing.T) {
	if !strings.Contains(listComputedDataStreamIDsByDeviceQuery, "JOIN data_streams") {
		t.Fatal("computed stream lookup must resolve device ownership through data_streams")
	}
	if strings.Contains(listComputedDataStreamIDsByDeviceQuery, "cds.device_id") {
		t.Fatal("computed_data_streams does not own a device_id column")
	}
}

func TestCreateRequiresCode(t *testing.T) {
	service := NewService(nil)

	_, err := service.Create(context.Background(), CreateInput{
		DeviceID:    uuid.New(),
		Name:        "Air temperature",
		Type:        "telemetry",
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestDataStreamTypeValidation(t *testing.T) {
	for _, value := range []string{"telemetry", "image", "video", "audio", "event", "log"} {
		if !isValidDataStreamType(value) {
			t.Fatalf("expected %q to be valid", value)
		}
	}
	if isValidDataStreamType("sql") {
		t.Fatal("sql should not be a valid data stream type")
	}
}

func TestDataStreamStatusValidation(t *testing.T) {
	for _, value := range []string{"active", "disabled", "archived"} {
		if !isValidDataStreamStatus(value) {
			t.Fatalf("expected %q to be valid", value)
		}
	}
	if isValidDataStreamStatus("retired") {
		t.Fatal("retired should not be a valid data stream status")
	}
}
