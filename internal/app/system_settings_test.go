package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/adminauth"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/systemsettings"
	"thcpn-gin/internal/testdb"
)

func TestSystemSettingsAdministratorBoundary(t *testing.T) {
	pool := testdb.Open(t, 0)
	actor := testdb.Admin(t, pool)
	cfg := config.Default()
	svc := systemsettings.New(pool, cfg)
	tokens := auth.NewTokenManager("isolated-settings-test-secret", time.Hour)
	adminService := adminauth.NewService(pool, tokens, time.Hour, 24*time.Hour, cfg.Auth.Password)
	r := gin.New()
	api := r.Group("/api/v1")
	api.Use(settingsMiddleware(svc))
	admin := api.Group("/admin")
	admin.Use(adminauth.Middleware(tokens, adminService))
	registerSystemSettings(api, admin, svc, audit.NewService(pool))
	token, err := tokens.Generate(actor)
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := tokens.Generate(uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body, bearer string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		r.ServeHTTP(w, req)
		return w
	}
	for _, test := range []struct {
		path, token string
		want        int
	}{{"/api/v1/system/policy", "", 200}, {"/api/v1/admin/settings", "", 401}, {"/api/v1/admin/settings", outsider.AccessToken, 401}, {"/api/v1/admin/settings", token.AccessToken, 200}} {
		w := request(http.MethodGet, test.path, "", test.token)
		if w.Code != test.want {
			t.Fatalf("%s got %d: %s", test.path, w.Code, w.Body.String())
		}
	}
	payload := `{"values":{"query_points":37},"reason":"管理员调整单次查询点数"}`
	if w := request(http.MethodPut, "/api/v1/admin/settings", payload, outsider.AccessToken); w.Code != 401 {
		t.Fatalf("outsider wrote settings: %s", w.Body.String())
	}
	if w := request(http.MethodPut, "/api/v1/admin/settings", payload, token.AccessToken); w.Code != 200 {
		t.Fatalf("admin save: %d %s", w.Code, w.Body.String())
	}
	w := request(http.MethodGet, "/api/v1/system/policy", "", "")
	var policy systemsettings.Snapshot
	if err = json.Unmarshal(w.Body.Bytes(), &policy); err != nil || policy.Values["query_points"] != 37 {
		t.Fatalf("public policy not updated: %s %v", w.Body.String(), err)
	}
	if w = request(http.MethodPut, "/api/v1/admin/settings", `{"values":{"query_points":2.5},"reason":"不接受非整数配置值"}`, token.AccessToken); w.Code != 400 {
		t.Fatalf("fraction accepted: %s", w.Body.String())
	}
	urlPayload := `{"public_base_url":"https://ieswatch.com/","reason":"管理员更新平台访问地址"}`
	if w = request(http.MethodPut, "/api/v1/admin/settings", urlPayload, outsider.AccessToken); w.Code != 401 {
		t.Fatalf("outsider changed deployment URL: %s", w.Body.String())
	}
	if w = request(http.MethodPut, "/api/v1/admin/settings", urlPayload, token.AccessToken); w.Code != 200 {
		t.Fatalf("URL-only update failed: %d %s", w.Code, w.Body.String())
	}
	w = request(http.MethodGet, "/api/v1/system/policy", "", "")
	if err = json.Unmarshal(w.Body.Bytes(), &policy); err != nil || policy.PublicBaseURL != "https://ieswatch.com" || policy.Values["query_points"] != 37 {
		t.Fatalf("public URL not updated or numeric settings lost: %s %v", w.Body.String(), err)
	}
	for _, invalid := range []string{`{"public_base_url":42,"reason":"不允许数值访问地址"}`, `{"public_base_url":"https://site.example/admin","reason":"不允许路径作为地址"}`, `{"public_base_url":"https://site.example","reason":"短"}`} {
		if w = request(http.MethodPut, "/api/v1/admin/settings", invalid, token.AccessToken); w.Code != 400 {
			t.Fatalf("invalid URL update accepted: %d %s", w.Code, w.Body.String())
		}
	}
	if w = request(http.MethodPut, "/api/v1/admin/settings", `{"public_base_url":"","reason":"清除保存的平台地址"}`, token.AccessToken); w.Code != 200 {
		t.Fatalf("URL reset failed: %d %s", w.Code, w.Body.String())
	}
	w = request(http.MethodGet, "/api/v1/system/policy", "", "")
	if err = json.Unmarshal(w.Body.Bytes(), &policy); err != nil || policy.PublicBaseURL != "" {
		t.Fatalf("public address not reset to unconfigured state: %s %v", w.Body.String(), err)
	}
}
