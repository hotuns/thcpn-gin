package datasource

import (
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http/httptest"
	"testing"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestPhysicalNodeManagementRequiresAdministrator(t *testing.T) {
	for _, actor := range []auth.Actor{{}, {UserID: uuid.New()}} {
		router := gin.New()
		router.Use(func(c *gin.Context) { auth.SetActorContext(c, actor); c.Next() })
		for _, method := range []string{"GET", "POST"} {
			router.Handle(method, "/devices/:device_id/physical-nodes", NewHandler(nil, nil).AdminLoRaWANPhysicalNodes)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(method, "/devices/"+uuid.NewString()+"/physical-nodes", nil))
			if response.Code != 401 {
				t.Fatalf("ordinary account reached node inventory: %s %d", method, response.Code)
			}
		}
	}
}

func TestPhysicalNodeListReadsPlatformWhileGatewaySyncIsLocked(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, gateway := uuid.New(), uuid.New()
	for _, query := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:unavailable',$2)`, []any{source, admin}},
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')`, []any{gateway}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, []any{gateway, source}},
		{`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index) VALUES($1,10,'NODE-A',$2,3)`, []any{source, gateway}},
	} {
		if _, err := db.Exec(ctx, query.sql, query.args...); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(db)
	unlock, err := service.LoRaWAN.LockSourceSync(ctx, source.String()+"/lorawan_v2/GW")
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	router := gin.New()
	router.Use(func(c *gin.Context) {
		auth.SetActorContext(c, auth.Actor{UserID: admin, IsSystemAdmin: true})
		c.Next()
	})
	router.GET("/devices/:device_id/physical-nodes", NewHandler(service, nil).AdminLoRaWANPhysicalNodes)
	requestCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	request := httptest.NewRequest("GET", "/devices/"+gateway.String()+"/physical-nodes", nil).WithContext(requestCtx)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	var result lorawanv2.PhysicalNodes
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil ||
		result.GatewaySN != "GW" || result.BoundNodeCount != 1 || len(result.Data) != 1 || result.Data[0].SN != "NODE-A" {
		t.Fatalf("cached node list failed while source unavailable and sync locked: %d %s", response.Code, response.Body)
	}
}
