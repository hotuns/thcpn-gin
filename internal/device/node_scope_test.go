package device

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/testdb"
)

func TestV2NodeScopesDoNotTreatCapacityOrLegacyPositionsAsInstalled(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, gateway := uuid.New(), uuid.New()
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'v2','http_api','lorawan_v2','env:UNUSED',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'gateway','gateway')`, gateway)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	must(`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES($1,'lorawan_v2_nodes_count','old count','number','254',$2,$2)`, gateway, admin)
	must(`INSERT INTO node_profiles(device_id,node_index,name,updated_by,updated_by_type) SELECT $1,n,'',$2,'system_admin' FROM generate_series(1,254) n`, gateway, admin)
	for _, index := range []int{3, 100} {
		must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index) VALUES($1,$2,$3,$4,$5)`, source, index, fmt.Sprint("SN-", index), gateway, index)
	}
	service := NewService(db)
	asset, err := service.GetAsset(ctx, gateway)
	if err != nil || asset.ChildCount != 2 {
		t.Fatalf("capacity leaked into installed count: %d %v", asset.ChildCount, err)
	}
	handler := NewHandler(service, permission.NewChecker(sqlc.New(db)))
	router := gin.New()
	router.Use(func(c *gin.Context) {
		auth.SetActorContext(c, auth.Actor{UserID: admin, IsSystemAdmin: true})
		c.Next()
	})
	router.GET("/devices/:device_id/nodes", handler.AdminNodes)
	var originalKey string
	for _, tc := range []struct {
		scope string
		count int
	}{{"", 2}, {"bound", 2}, {"history", 252}, {"all", 254}} {
		response := httptest.NewRecorder()
		path := "/devices/" + gateway.String() + "/nodes"
		if tc.scope != "" {
			path += "?scope=" + tc.scope
		}
		router.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		var result struct {
			Items []GatewayNode `json:"items"`
		}
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Items) != tc.count {
			t.Fatalf("%s: %d %s", tc.scope, response.Code, response.Body.String())
		}
		if tc.scope == "" {
			if *result.Items[0].Target.NodeIndex != 3 || *result.Items[1].Target.NodeIndex != 100 {
				t.Fatal("sparse node indices were renumbered")
			}
			originalKey = result.Items[0].Key
		}
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/devices/"+gateway.String()+"/nodes?scope=invalid", nil))
	if response.Code != 400 {
		t.Fatal("invalid scope accepted")
	}
	must(`UPDATE lorawan_physical_nodes SET gateway_device_id=NULL,node_index=NULL WHERE gateway_device_id=$1 AND node_index=3`, gateway)
	current, err := service.ListGatewayNodesInScope(ctx, gateway, "bound")
	if err != nil || len(current) != 1 || *current[0].Target.NodeIndex != 100 {
		t.Fatalf("unbound node still actionable: %+v %v", current, err)
	}
	history, err := service.ListGatewayNodesInScope(ctx, gateway, "history")
	if err != nil {
		t.Fatal(err)
	}
	if history[2].Key != originalKey {
		t.Fatal("unbinding changed historical query identity")
	}
}
