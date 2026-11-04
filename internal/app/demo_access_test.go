package app

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/dashboard"
	"thcpn-gin/internal/demoshowcase"
	"thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/testdb"
)

func TestDemoLoginUsesSelectedDevicesWithoutPermissionSetup(t *testing.T) {
	pool := testdb.Open(t, 0)
	ctx := t.Context()
	cfg := config.Default()
	cfg.Auth.DevUserHeaderEnabled = false
	cfg.Billing.Enabled = true
	admin := testdb.Admin(t, pool)
	showcase := demoshowcase.NewService(pool, cfg.Auth.Password)
	account, err := showcase.Create(ctx, "showcase-test", "Showcase", "DemoAccess123!")
	if err != nil {
		t.Fatal(err)
	}
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Deliberately remove copied permission rows. Curating a showcase is enough.
	must(`DELETE FROM workspace_member_permissions WHERE member_id IN (SELECT id FROM workspace_members WHERE user_id=$1)`, account.UserID)
	gateway, child, hidden, stream, childStream, source := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway'),($2,'Child','gateway_node'),($3,'Not selected','standalone')`, gateway, child, hidden)
	if err := showcase.AddDevice(ctx, account.UserID, gateway, admin); err != nil {
		t.Fatal(err)
	}
	pointAt := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var payload any
		switch {
		case r.URL.Path == "/device/GW/nodes":
			payload = map[string]any{"gateway_sn": "GW", "bound_node_count": 1, "data": []any{map[string]any{"id": 1, "sn": "NODE", "gateway_sn": "GW", "node_index": 1}}}
		case strings.HasSuffix(r.URL.Path, "/statistics"):
			start, _ := strconv.ParseInt(r.URL.Query().Get("start_at"), 10, 64)
			end, _ := strconv.ParseInt(r.URL.Query().Get("end_at"), 10, 64)
			location := time.FixedZone("Asia/Shanghai", 8*60*60)
			local := time.Unix(start, 0).In(location)
			day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
			daily := []any{}
			for day.Before(time.Unix(end, 0)) {
				count := 0
				if day.Format(time.DateOnly) == pointAt.In(location).Format(time.DateOnly) {
					count = 1
				}
				daily = append(daily, map[string]any{"date": day.Format(time.DateOnly), "count": count})
				day = day.AddDate(0, 0, 1)
			}
			payload = map[string]any{"gateway_sn": "GW", "node_index": 1, "timezone": "Asia/Shanghai", "generated_at": time.Now().UTC(), "as_of": time.Unix(end, 0).UTC(), "count_unit": "sample_record", "complete": true, "records": map[string]any{"total": 1, "first_at": pointAt, "last_at": pointAt, "daily": daily}, "images": map[string]any{"supported": false, "total": nil, "daily": nil}}
		case strings.HasSuffix(r.URL.Path, "/data"):
			payload = map[string]any{"data": []any{map[string]any{"ts": pointAt.Format(time.RFC3339), "temperature": 21.5}}, "pagination": map[string]any{"current_page": 1, "total_page": 1, "total_count": 1, "page_size": 50}}
		default:
			http.Error(w, "unexpected source request", 404)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": payload})
	}))
	defer upstream.Close()
	secret, _ := json.Marshal(map[string]string{"base_url": upstream.URL, "username": "test", "password": "test"})
	t.Setenv("DEMO_ACCESS_TEST_SOURCE", string(secret))
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Demo source','http_api','lorawan_v2','env:DEMO_ACCESS_TEST_SOURCE',$2)`, source, admin)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	must(`INSERT INTO device_relations(parent_device_id,child_device_id,relation_type,data_source_id,external_parent_device_id,external_child_device_id) VALUES($1,$2,'gateway_node',$3,1,2)`, gateway, child, source)
	for _, item := range []struct{ id, device uuid.UUID }{{stream, gateway}, {childStream, child}} {
		must(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,'temperature','Temperature','telemetry',$3,'system_admin')`, item.id, item.device, admin)
		must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,adapter_code,adapter_config_json,payload_type,created_by,created_by_type) VALUES($1,$2,'lorawan_v2','{"gateway_sn":"GW","node_index":1,"metric":"temperature"}','json',$3,'system_admin')`, item.id, source, admin)
	}
	router, err := NewRouter(Dependencies{Postgres: pool, Config: cfg, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	token := ""
	request := func(method, path, body string, want int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: want %d, got %d: %s", method, path, want, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	var login auth.LoginResult
	if err := json.Unmarshal(request("POST", "/api/v1/auth/demo/login", `{"username":"showcase-test","password":"DemoAccess123!"}`, 200), &login); err != nil {
		t.Fatal(err)
	}
	if login.AccessToken == "" || !login.User.IsDemo {
		t.Fatal("demo login did not return an ordinary authenticated demo session")
	}
	token = login.AccessToken
	workspacePath := "/api/v1/workspaces/" + account.WorkspaceID.String()
	request("GET", "/api/v1/devices?workspace_id="+account.WorkspaceID.String(), "", 200)
	for _, id := range []uuid.UUID{gateway, child} {
		var result telemetry.QueryResult
		path := fmt.Sprintf("/api/v1/devices/%s/telemetry?start_time=%s&end_time=%s", id, pointAt.Add(-time.Hour).Format(time.RFC3339), pointAt.Add(time.Minute).Format(time.RFC3339))
		if err := json.Unmarshal(request("GET", path, "", 200), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Series) != 1 || len(result.Series[0].Points) != 1 || result.Series[0].Points[0].Value != 21.5 {
			t.Fatalf("selected device %s did not reach telemetry source: %+v", id, result)
		}
	}
	oldStart := pointAt.AddDate(0, 0, -120)
	request("GET", fmt.Sprintf("/api/v1/data-streams/%s/telemetry?start_time=%s&end_time=%s", childStream, oldStart.Format(time.RFC3339), oldStart.Add(time.Hour).Format(time.RFC3339)), "", 200)
	// Real ownership and its base-plan history window must not replace demo scope.
	realOwner, realWorkspace := uuid.New(), uuid.New()
	must(`INSERT INTO users(id,name,email) VALUES($1,'Real owner','demo-access-owner@example.test')`, realOwner)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id) VALUES($1,'personal','Real workspace',$2)`, realWorkspace, realOwner)
	for _, id := range []uuid.UUID{gateway, hidden} {
		must(`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, id, realWorkspace)
	}
	request("GET", fmt.Sprintf("/api/v1/data-streams/%s/telemetry?start_time=%s&end_time=%s", childStream, oldStart.Format(time.RFC3339), oldStart.Add(time.Hour).Format(time.RFC3339)), "", 200)
	request("GET", "/api/v1/workspaces/"+realWorkspace.String()+"/dashboard?days=7", "", 403)
	request("GET", "/api/v1/devices/"+hidden.String(), "", 403)
	request("POST", workspacePath+"/wallboards", fmt.Sprintf(`{"name":"Outside showcase","template_code":"atlas-tech","config":{"device_ids":[%q]}}`, hidden), 400)
	var atlas struct {
		CanManage bool `json:"can_manage"`
	}
	if err := json.Unmarshal(request("GET", workspacePath+"/wallboards", "", 200), &atlas); err != nil || !atlas.CanManage {
		t.Fatalf("demo cannot use atlas: %v %+v", err, atlas)
	}
	board := request("POST", workspacePath+"/wallboards", fmt.Sprintf(`{"name":"Demo map","template_code":"atlas-tech","config":{"presentation":"deep-blue","device_ids":[%q],"telemetry_stream_ids":[%q],"trend_hours":24}}`, child, childStream), 201)
	var saved struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(board, &saved); err != nil {
		t.Fatal(err)
	}
	snapshot := request("GET", workspacePath+"/wallboards/"+saved.ID.String()+"/snapshot", "", 200)
	if !strings.Contains(string(snapshot), `"latest_value":21.5`) || !strings.Contains(string(snapshot), `"id":"`+child.String()+`"`) {
		t.Fatalf("atlas snapshot omitted demo child device or telemetry: %s", snapshot)
	}
	var overview dashboard.Overview
	deadline := time.Now().Add(3 * time.Second)
	for {
		if err := json.Unmarshal(request("GET", workspacePath+"/dashboard?days=7", "", 200), &overview); err != nil {
			t.Fatal(err)
		}
		if overview.Records.Total.Value != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("demo statistics never became available")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if *overview.Records.Total.Value != 1 || overview.Devices.Total != 1 {
		t.Fatalf("demo totals exclude configured devices: %+v", overview)
	}
	// A demo session never turns into a system-administrator session.
	request("GET", "/api/v1/admin/devices", "", 401)
	// Removing a reference takes effect immediately, including its children.
	if err := showcase.RemoveDevice(ctx, account.UserID, gateway); err != nil {
		t.Fatal(err)
	}
	for _, id := range []uuid.UUID{gateway, child, hidden} {
		request("GET", "/api/v1/devices/"+id.String(), "", 403)
	}
	request("GET", fmt.Sprintf("/api/v1/data-streams/%s/telemetry?start_time=%s&end_time=%s", childStream, pointAt.Add(-time.Hour).Format(time.RFC3339), pointAt.Add(time.Minute).Format(time.RFC3339)), "", 403)
	request("GET", workspacePath+"/wallboards/"+saved.ID.String()+"/snapshot", "", 400)
	if err := json.Unmarshal(request("GET", workspacePath+"/dashboard?days=7", "", 200), &overview); err != nil || overview.Devices.Total != 0 {
		t.Fatalf("removed showcase device remained in dashboard: %+v %v", overview, err)
	}
	must(`UPDATE workspaces SET is_demo_workspace=false WHERE id=$1`, account.WorkspaceID)
	request("GET", workspacePath+"/dashboard?days=7", "", 403)
	must(`UPDATE users SET status='disabled' WHERE id=$1`, account.UserID)
	request("GET", workspacePath+"/dashboard?days=7", "", 401)
}
