package device

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/testdb"
)

func TestNodeNamingPermissionsPersistenceAndMigration(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Validate reversible migration in an isolated database, never the user's data.
	testdb.Apply(t, db, "../../migrations/000037_node_profiles.down.sql")
	testdb.Apply(t, db, "../../migrations/000037_node_profiles.up.sql")
	owner, viewer, outsider, workspace := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{owner, viewer, outsider} {
		must(`INSERT INTO users(id,name,email) VALUES($1,'Test',$2)`, id, id.String()+"@test.invalid")
	}
	must(`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','Test',$2)`, workspace, owner)
	for _, m := range []struct {
		id   uuid.UUID
		role string
	}{{owner, "owner"}, {viewer, "viewer"}} {
		must(`INSERT INTO workspace_members(workspace_id,user_id,role_id,scope_id,template_code) SELECT $1,$2,id,$1,$3 FROM roles WHERE code=$3 AND workspace_id IS NULL LIMIT 1`, workspace, m.id, m.role)
	}
	must(`INSERT INTO workspace_member_permissions(member_id,permission_id) SELECT wm.id,rp.permission_id FROM workspace_members wm JOIN role_permissions rp ON rp.role_id=wm.role_id WHERE wm.workspace_id=$1`, workspace)

	source, gateway, carbon, node := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','env:NOT_USED',$2)`, source, admin)
	for _, d := range []struct {
		id   uuid.UUID
		kind string
	}{{gateway, "gateway"}, {carbon, "carbon_sink"}, {node, "gateway_node"}} {
		must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Original',$2)`, d.id, d.kind)
		if d.kind != "gateway_node" {
			must(`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, d.id, workspace)
		}
	}
	must(`INSERT INTO device_relations(parent_device_id,child_device_id,relation_type,data_source_id,external_parent_device_id,external_child_device_id) VALUES($1,$2,'gateway_node',$3,1,2)`, gateway, node, source)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','TEST-SN')`, gateway, source)
	must(`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES($1,'lorawan_v2_nodes_count','Nodes','number','4',$2,$2)`, gateway, admin)
	svc := NewService(db)
	h := NewHandler(svc, permission.NewChecker(sqlc.New(db)))
	call := func(id uuid.UUID, index string, name string, actor auth.Actor, adminRoute bool) *httptest.ResponseRecorder {
		t.Helper()
		router := gin.New()
		router.Use(func(c *gin.Context) { auth.SetActorContext(c, actor); c.Next() })
		if index == "" {
			if adminRoute {
				router.PATCH("/devices/:device_id", h.AdminUpdate)
			} else {
				router.PATCH("/devices/:device_id", h.Update)
			}
		} else {
			if adminRoute {
				router.PATCH("/devices/:device_id/nodes/:node_index", h.AdminRenameNode)
			} else {
				router.PATCH("/devices/:device_id/nodes/:node_index", h.RenameNode)
			}
		}
		path := "/devices/" + id.String()
		if index != "" {
			path += "/nodes/" + index
		}
		raw, _ := json.Marshal(map[string]string{"name": name})
		req := httptest.NewRequest(http.MethodPatch, path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		return resp
	}
	user := auth.Actor{UserID: owner}
	sys := auth.Actor{UserID: admin, IsSystemAdmin: true}
	expect := func(r *httptest.ResponseRecorder, status int) {
		t.Helper()
		if r.Code != status {
			t.Fatalf("got %d want %d: %s", r.Code, status, r.Body.String())
		}
	}
	for _, id := range []uuid.UUID{viewer, outsider} {
		expect(call(gateway, "1", "Denied", auth.Actor{UserID: id}, false), 403)
	}
	expect(call(gateway, "3", "  林下  ", user, false), 200)
	expect(call(gateway, "4", "林下", sys, true), 200) // duplicate names are intentional
	for _, index := range []string{"0", "-1", "5"} {
		expect(call(gateway, index, "Bad", user, false), 400)
	}
	expect(call(carbon, "1", "碳汇样地", user, false), 200)
	expect(call(carbon, "2", "Bad", user, false), 400)
	expect(call(node, "", "树干", user, false), 200)
	expect(call(node, "", "", sys, true), 400)
	expect(call(node, "", "换\n行", sys, true), 400)
	nodes, err := svc.ListGatewayNodes(ctx, gateway)
	if err != nil {
		t.Fatal(err)
	}
	stable := nodes[2].Key
	if nodes[2].Name != "林下 · 节点 3" || nodes[3].CustomName != "林下" {
		t.Fatalf("names %#v", nodes)
	}
	must(`UPDATE device_metadata SET value_json='2' WHERE device_id=$1 AND key='lorawan_v2_nodes_count'`, gateway)
	nodes, err = svc.ListGatewayNodes(ctx, gateway)
	if err != nil || len(nodes) != 2 {
		t.Fatalf("reduced nodes: %v %v", nodes, err)
	}
	expect(call(gateway, "3", "Hidden", sys, true), 400)
	must(`UPDATE device_metadata SET value_json='4' WHERE device_id=$1 AND key='lorawan_v2_nodes_count'`, gateway)
	nodes, err = svc.ListGatewayNodes(ctx, gateway)
	if err != nil || nodes[2].Key != stable || nodes[2].CustomName != "林下" {
		t.Fatalf("restored nodes: %v %v", nodes, err)
	}
	expect(call(gateway, "3", "  ", sys, true), 200)
	nodes, err = svc.ListGatewayNodes(ctx, gateway)
	if err != nil || nodes[2].Name != "节点 3" {
		t.Fatal("clear failed", err)
	}
	var count int
	if err = db.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE action='device.node.rename' AND workspace_id=$1 AND actor_id=$2 AND reason::jsonb->>'new_name' IN ('林下','碳汇样地','树干')`, workspace, owner).Scan(&count); err != nil || count != 3 {
		t.Fatalf("audit count %d: %v", count, err)
	}
	for i := 0; i < 2; i++ {
		demo, space := uuid.New(), uuid.New()
		must(`INSERT INTO users(id,name,is_demo,username) VALUES($1,'Demo',true,$2)`, demo, demo.String())
		must(`INSERT INTO workspaces(id,type,name,owner_user_id,is_demo_workspace) VALUES($1,'personal','Demo',$2,true)`, space, demo)
		must(`INSERT INTO workspace_members(workspace_id,user_id,role_id,scope_id,template_code) SELECT $1,$2,id,$1,'owner' FROM roles WHERE code='owner' AND workspace_id IS NULL LIMIT 1`, space, demo)
		must(`INSERT INTO workspace_member_permissions(member_id,permission_id) SELECT wm.id,rp.permission_id FROM workspace_members wm JOIN role_permissions rp ON rp.role_id=wm.role_id WHERE wm.workspace_id=$1`, space)
		must(`INSERT INTO demo_showcase_devices(user_id,workspace_id,device_id,added_by) VALUES($1,$2,$3,$4)`, demo, space, gateway, admin)
		expect(call(gateway, "1", "共享名称", auth.Actor{UserID: demo, IsDemo: true}, false), 200)
		nodes, e := svc.ListGatewayNodes(ctx, gateway)
		if e != nil || nodes[0].CustomName != "共享名称" {
			t.Fatal("demo name not shared", e)
		}
		var audited int
		if e = db.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE actor_id=$1 AND workspace_id=$2 AND resource_id=$3 AND action='device.node.rename'`, demo, space, gateway).Scan(&audited); e != nil || audited != 1 {
			t.Fatal("wrong demo audit scope", e)
		}
	}

	var deviceName string
	if err = db.QueryRow(ctx, "SELECT name FROM devices WHERE id=$1", node).Scan(&deviceName); err != nil || deviceName != "树干" {
		t.Fatal("THCPN name not persisted", err)
	}
}
