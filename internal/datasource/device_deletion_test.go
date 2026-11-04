package datasource

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"testing"
	"thcpn-gin/internal/testdb"
)

func TestDeviceDeletionProtectsBusinessHistory(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	service := NewService(db)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	actor := testdb.Admin(t, db)
	source := uuid.New()
	exec("INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'test','http_api','lorawan_v2','env:UNUSED',$2)", source, actor)
	user, workspace := uuid.New(), uuid.New()
	exec("INSERT INTO users(id,name,email) VALUES($1,'fixture',$2)", user, user.String()+"@test.invalid")
	exec("INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','fixture',$2)", workspace, user)
	for _, kind := range []string{"unused", "previewed", "retired", "child", "removed_assignment", "dataset"} {
		t.Run(kind, func(t *testing.T) {
			id := uuid.New()
			exec("INSERT INTO devices(id,name,serial_no,device_type) VALUES($1,$2,$2,'camera')", id, kind)
			switch kind {
			case "unused":
				exec("INSERT INTO camera_bindings(device_id,device_serial) VALUES($1,'VENDOR-SN')", id)
			case "previewed":
				exec("INSERT INTO audit_logs(actor_type,action,resource_type,resource_id,result) VALUES('system','camera.live_session.create','device',$1,'success')", id)
			case "retired":
				exec("UPDATE devices SET lifecycle_status='retired' WHERE id=$1", id)
			case "removed_assignment":
				exec("INSERT INTO device_assignments(device_id,workspace_id,status) VALUES($1,$2,'removed')", id, workspace)
			case "dataset":
				dataset := uuid.New()
				exec("INSERT INTO datasets(id,workspace_id,name,data_type,time_start,time_end,created_by) VALUES($1,$2,'fixture','telemetry',now()-interval '1 day',now(),$3)", dataset, workspace, user)
				exec("INSERT INTO dataset_sources(dataset_id,source_type,source_id) VALUES($1,'device',$2)", dataset, id)
			case "child":
				child := uuid.New()
				exec("INSERT INTO devices(id,name,serial_no,device_type) VALUES($1,'node','test-child','gateway_node')", child)
				exec("INSERT INTO device_relations(parent_device_id,child_device_id,relation_type,data_source_id,external_parent_device_id,external_child_device_id) VALUES($1,$2,'gateway_node',$3,1,2)", id, child, source)
			}
			target := deletionTarget{device: id}
			checked, err := service.deleteAsset(ctx, target, deletionInput{}, actor, false)
			if err != nil || checked.Allowed != (kind == "unused") {
				t.Fatalf("unexpected preview: %+v %v", checked, err)
			}
			if kind == "unused" && checked.Confirmation != "VENDOR-SN" {
				t.Fatalf("wrong camera confirmation: %+v", checked)
			}
			outcome, err := service.deleteAsset(ctx, target, deletionInput{Confirmation: checked.Confirmation}, actor, true)
			if err != nil || (outcome.State == "deleted") != (kind == "unused") {
				t.Fatalf("unexpected delete: %+v %v", outcome, err)
			}
		})
	}
}

func TestGatewayDeletionRecoversWithoutDeletingReusedSN(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	deleted := false
	writes := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			id := 11
			if deleted {
				id = 12
			}
			fmt.Fprintf(w, `{"success":true,"payload":{"id":%d,"sn":"GW"}}`, id)
			return
		}
		var target struct {
			ID int64 `json:"expected_id"`
		}
		if json.NewDecoder(r.Body).Decode(&target) != nil || target.ID != 11 {
			t.Error("source call did not retain original ID")
		}
		state := "eligible"
		if deleted {
			state = "absent"
		}
		if r.Method == http.MethodDelete {
			writes++
			deleted = true
			state = "deleted"
		}
		fmt.Fprintf(w, `{"success":true,"payload":{"state":%q,"reasons":[]}}`, state)
	}))
	defer upstream.Close()
	secret, _ := json.Marshal(map[string]string{"base_url": upstream.URL, "username": "test", "password": "test"})
	t.Setenv("TEST_DEVICE_DELETION_SOURCE", string(secret))
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	id, source := uuid.New(), uuid.New()
	exec("INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'test','http_api','lorawan_v2','env:TEST_DEVICE_DELETION_SOURCE',$2)", source, actor)
	exec("INSERT INTO devices(id,name,serial_no,device_type) VALUES($1,'gateway','GW','gateway')", id)
	exec("INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')", id, source)
	exec(`CREATE FUNCTION test_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$`)
	exec("CREATE TRIGGER test_no_delete BEFORE DELETE ON devices FOR EACH ROW EXECUTE FUNCTION test_no_delete()")
	s := NewService(db)
	target := deletionTarget{device: id}
	input := deletionInput{Confirmation: "GW", ExpectedID: 11, Reason: "误建"}
	result, err := s.deleteAsset(ctx, target, input, actor, true)
	if err != nil || result.State != "partial" || result.OperationID == nil {
		t.Fatalf("expected recoverable partial: %+v %v", result, err)
	}
	exec("DROP TRIGGER test_no_delete ON devices")
	checked, err := s.deleteAsset(ctx, target, deletionInput{}, actor, false)
	if err != nil || checked.State != "partial" || checked.ExpectedID != 11 {
		t.Fatalf("wrong recovery target: %+v %v", checked, err)
	}
	result, err = s.deleteAsset(ctx, target, input, actor, true)
	if err != nil || result.State != "deleted" || writes != 1 {
		t.Fatalf("unexpected recovery: %+v %v, source writes %d", result, err, writes)
	}
	op, err := s.GetSourceOperation(ctx, *result.OperationID)
	if err != nil || op.Status != "completed" {
		t.Fatalf("operation lost: %+v %v", op, err)
	}
	testdb.Apply(t, db, "../../migrations/000054_device_deletion.down.sql")
	testdb.Apply(t, db, "../../migrations/000054_device_deletion.up.sql")
}
