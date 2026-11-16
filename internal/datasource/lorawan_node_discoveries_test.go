package datasource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestNodeDiscoveriesRejectNonAdminAndInvalidPagination(t *testing.T) {
	for _, tc := range []struct {
		name   string
		actor  auth.Actor
		query  string
		status int
	}{
		{"anonymous", auth.Actor{}, "", http.StatusUnauthorized},
		{"operator", auth.Actor{UserID: uuid.New()}, "", http.StatusUnauthorized},
		{"invalid page syntax", auth.Actor{UserID: uuid.New(), IsSystemAdmin: true}, "?page=abc", http.StatusBadRequest},
		{"invalid page", auth.Actor{UserID: uuid.New(), IsSystemAdmin: true}, "?page=0", http.StatusBadRequest},
		{"invalid size", auth.Actor{UserID: uuid.New(), IsSystemAdmin: true}, "?page_size=51", http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			router.Use(func(c *gin.Context) { auth.SetActorContext(c, tc.actor); c.Next() })
			router.GET("/devices/:device_id/lorawan-v2/node-discoveries", NewHandler(nil, nil).AdminLoRaWANNodeDiscoveries)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "/devices/"+uuid.NewString()+"/lorawan-v2/node-discoveries"+tc.query, nil))
			if response.Code != tc.status {
				t.Fatalf("status=%d, want %d: %s", response.Code, tc.status, response.Body.String())
			}
		})
	}
}

func TestNodeDiscoveriesAreScopedToTheRequestedGateway(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor, source, gateway := testdb.Admin(t, db), uuid.New(), uuid.New()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'source','http_api','lorawan_v2','secret:test',$2)`, []any{source, actor}},
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'gateway','gateway')`, []any{gateway}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW-LOCAL')`, []any{gateway, source}},
	} {
		if _, err := db.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/node-discoveries" || r.URL.Query().Get("gateway_sn") != "GW-LOCAL" || r.URL.Query().Get("status") != "pending" || r.URL.Query().Get("page") != "2" || r.URL.Query().Get("page_size") != "10" {
			t.Errorf("unexpected upstream query: %s %s", r.Method, r.URL)
			w.WriteHeader(400)
			return
		}
		fmt.Fprint(w, `{"success":true,"payload":{"pagination":{"current_page":2,"page_size":10,"total_page":2,"total_count":11},"data":[{"id":11,"node_sn":"aabbccddeeff","gateway_sn":"GW-LOCAL","node_index":3,"reason":"slot_occupied","status":"pending","current_node_sn":"112233445566","bound_gateway_sn":null,"bound_node_index":null,"first_seen_at":"2026-11-15T08:53:39Z","last_seen_at":"2026-11-16T00:13:35Z","seen_count":38,"resolved_at":null}]}}`)
	}))
	defer server.Close()
	service := NewService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	service.Runtime = platform.NewRuntime(staticResolver(secret))
	router := gin.New()
	router.Use(func(c *gin.Context) {
		auth.SetActorContext(c, auth.Actor{UserID: actor, IsSystemAdmin: true})
		c.Next()
	})
	router.GET("/devices/:device_id/lorawan-v2/node-discoveries", NewHandler(service, nil).AdminLoRaWANNodeDiscoveries)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/devices/"+gateway.String()+"/lorawan-v2/node-discoveries?page=2&page_size=10&gateway_sn=OTHER&status=resolved", nil))
	if response.Code != 200 {
		t.Fatalf("status=%d: %s", response.Code, response.Body.String())
	}
	var result struct {
		Data []struct {
			NodeSN    string `json:"node_sn"`
			CurrentSN string `json:"current_node_sn"`
			Reason    string `json:"reason"`
			Status    string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || len(result.Data) != 1 || result.Data[0].NodeSN != "aabbccddeeff" || result.Data[0].CurrentSN != "112233445566" || result.Data[0].Reason != "slot_occupied" || result.Data[0].Status != "pending" {
		t.Fatalf("discovery identity lost: %+v %v", result, err)
	}
}
