package deviceprofile

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/testdb"
)

func TestGatewayDetailsRegistrationAndTypeScope(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	source, gateway, station := uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	testdb.Apply(t, db, "../../migrations/000050_lorawan_gateway_details.down.sql")
	testdb.Apply(t, db, "../../migrations/000050_lorawan_gateway_details.up.sql")
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)`, source, actor)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway'),($2,'Station','standalone')`, gateway, station)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	svc := NewService(db, nil, nil)
	blank, err := svc.GatewayDetails(ctx, gateway)
	if err != nil || blank.AppKey != "" {
		t.Fatalf("empty record: %#v %v", blank, err)
	}
	input := GatewayDetails{AppKey: "00112233445566778899aabbccddeeff", EUI: "0011223344556677", WiFiName: "样地 Wi-Fi"}
	if _, err := svc.SaveGatewayDetails(ctx, gateway, actor, input); err != nil {
		t.Fatal(err)
	}
	got, err := svc.GatewayDetails(ctx, gateway)
	if err != nil || got != input {
		t.Fatalf("registration roundtrip failed: %v", err)
	}
	// Updating registration must not write gateway configuration snapshots.
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM lorawan_gateway_details WHERE device_id=$1", gateway).Scan(&count); err != nil || count != 1 {
		t.Fatalf("registration row: %d %v", count, err)
	}
	input.WiFiName = "Changed"
	if _, err := svc.SaveGatewayDetails(ctx, gateway, actor, input); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveGatewayDetails(ctx, station, actor, input); err == nil {
		t.Fatal("standard station accepted gateway information")
	}
	if _, err := svc.SaveGatewayDetails(ctx, gateway, actor, GatewayDetails{EUI: strings.Repeat("X", 129)}); err == nil {
		t.Fatal("oversized registration accepted")
	}
	if _, err := svc.SaveGatewayDetails(ctx, gateway, actor, GatewayDetails{}); err != nil {
		t.Fatal(err)
	}
	got, err = svc.GatewayDetails(ctx, gateway)
	if err != nil || got != (GatewayDetails{}) {
		t.Fatal("clearing registration failed")
	}
}
func TestGatewayDetailsRequiresAdministratorForWrites(t *testing.T) {
	h := NewHandler(nil, nil, nil)
	for _, authenticated := range []bool{false, true} {
		router := gin.New()
		if authenticated {
			router.Use(func(c *gin.Context) { auth.SetActorContext(c, auth.Actor{UserID: uuid.New()}); c.Next() })
		}
		router.PUT("/devices/:device_id/gateway-details", h.SaveGatewayDetails)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/devices/"+uuid.NewString()+"/gateway-details", strings.NewReader(`{}`)))
		if response.Code != http.StatusUnauthorized && response.Code != http.StatusForbidden {
			t.Fatalf("user write reached service: %d", response.Code)
		}
	}
}
