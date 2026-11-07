package systemsettings

import (
	"encoding/json"
	"testing"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/testdb"
)

func TestDeploymentURLDefaultsAndPublicPolicy(t *testing.T) {
	cfg := config.Default()
	for _, url := range []string{"", "http://127.0.0.1:5173/"} {
		cfg.Deployment.PublicBaseURL = url
		snapshot, err := New(nil, cfg).Load(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		want, _ := config.NormalizePublicBaseURL(url)
		if snapshot.PublicBaseURL != want || snapshot.DefaultPublicBaseURL != want {
			t.Fatalf("bad defaults: %+v", snapshot)
		}
		public := Public(snapshot)
		if public.PublicBaseURL != want || public.DefaultPublicBaseURL != "" {
			t.Fatalf("bad public URL: %+v", public)
		}
		raw, _ := json.Marshal(public)
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(raw, &fields)
		if _, ok := fields["public_base_url"]; !ok {
			t.Fatal("empty public base URL must still be present")
		}
		if _, ok := fields["default_public_base_url"]; ok {
			t.Fatal("startup default leaked into public policy")
		}
	}
}

func TestDeploymentURLPersistenceResetAndAudit(t *testing.T) {
	pool := testdb.Open(t, 0)
	actor := testdb.Admin(t, pool)
	cfg := config.Default()
	cfg.Deployment.PublicBaseURL = "https://startup.example/"
	svc := New(pool, cfg)
	address := "https://IESWATCH.COM/"
	snapshot, err := svc.Update(t.Context(), UpdateInput{PublicBaseURL: &address, Reason: "修改平台公开访问地址"}, Actor{ID: actor})
	if err != nil || snapshot.PublicBaseURL != "https://ieswatch.com" || snapshot.Version != 1 {
		t.Fatalf("URL-only update failed: %+v %v", snapshot, err)
	}
	cfg.Deployment.PublicBaseURL = "http://localhost:5173"
	svc = New(pool, cfg)
	snapshot, err = svc.Load(t.Context())
	if err != nil || snapshot.PublicBaseURL != "https://ieswatch.com" || snapshot.DefaultPublicBaseURL != "http://localhost:5173" {
		t.Fatalf("persisted URL did not override new startup default: %+v %v", snapshot, err)
	}
	snapshot, err = svc.Update(t.Context(), UpdateInput{Values: Values{"query_days": 7}, Reason: "仅修改数值业务参数"}, Actor{ID: actor})
	if err != nil || snapshot.PublicBaseURL != "https://ieswatch.com" {
		t.Fatalf("numeric patch changed public address: %+v %v", snapshot, err)
	}
	for _, invalid := range []string{"https://site.example/path", "https://user:pass@site.example", "http://site.example?token=x"} {
		_, err = svc.Update(t.Context(), UpdateInput{PublicBaseURL: &invalid, Reason: "验证错误地址不能保存"}, Actor{ID: actor})
		if apperr.KindOf(err) != apperr.KindInvalidArgument {
			t.Fatalf("invalid address accepted: %q %v", invalid, err)
		}
	}
	address = ""
	snapshot, err = svc.Update(t.Context(), UpdateInput{PublicBaseURL: &address, Reason: "恢复部署环境访问地址"}, Actor{ID: actor})
	if err != nil || snapshot.PublicBaseURL != "http://localhost:5173" || snapshot.Version != 3 || snapshot.Values["query_days"] != 7 {
		t.Fatalf("reset did not preserve values and restore default: %+v %v", snapshot, err)
	}
	var stored *string
	if err = pool.QueryRow(t.Context(), `SELECT public_base_url FROM system_settings`).Scan(&stored); err != nil || stored != nil {
		t.Fatalf("reset must clear override: %v %v", stored, err)
	}
	history, err := svc.History(t.Context())
	if err != nil || len(history) != 3 {
		t.Fatalf("expected three successful changes: %+v %v", history, err)
	}
	if history[0].BeforePublicBaseURL != "https://ieswatch.com" || history[0].AfterPublicBaseURL != "http://localhost:5173" ||
		history[2].BeforePublicBaseURL != "https://startup.example" || history[2].AfterPublicBaseURL != "https://ieswatch.com" {
		t.Fatalf("URL history incorrect: %+v", history)
	}
	var audits int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM audit_logs WHERE action='system.settings.update' AND actor_admin_id=$1`, actor).Scan(&audits); err != nil || audits != 3 {
		t.Fatalf("URL edits were not audited: %d %v", audits, err)
	}
	// Rollback removes only the new columns; prior numerical values and audit history survive.
	testdb.Apply(t, pool, "../../migrations/000056_deployment_public_url.down.sql")
	testdb.Apply(t, pool, "../../migrations/000056_deployment_public_url.up.sql")
	snapshot, err = svc.Load(t.Context())
	if err != nil || snapshot.Values["query_days"] != 7 || snapshot.Version != 3 || snapshot.PublicBaseURL != cfg.Deployment.PublicBaseURL {
		t.Fatalf("migration roundtrip lost numeric settings: %+v %v", snapshot, err)
	}
	history, err = svc.History(t.Context())
	if err != nil || len(history) != 3 || history[0].BeforePublicBaseURL != "" || history[0].AfterPublicBaseURL != "" {
		t.Fatalf("pre-migration history did not load: %+v %v", history, err)
	}
}
