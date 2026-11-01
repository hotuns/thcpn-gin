package systemsettings

import (
	"strings"
	"testing"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/testdb"
)

func TestSettingsPersistAuditAndFreezeInFlightContext(t *testing.T) {
	pool := testdb.Open(t, 0)
	actor := testdb.Admin(t, pool)
	cfg := config.Default()
	cfg.QueryLimits.MaxHistoryDays = 21
	svc := New(pool, cfg)
	before, err := svc.Load(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if before.Values["query_days"] != 21 || before.BillingEnabled {
		t.Fatalf("startup defaults ignored: %+v", before)
	}
	oldCtx, err := svc.Context(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	updated, err := svc.Update(t.Context(), UpdateInput{Values: Values{"query_days": 7, "node_name": 150, "billing_enabled": 1}, Reason: "调整查询和节点名称配置"}, Actor{ID: actor})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Version != 1 || updated.Values["query_days"] != 7 || !updated.BillingEnabled {
		t.Fatalf("save failed: %+v", updated)
	}
	if Int(oldCtx, "query_days", 0) != 21 {
		t.Fatal("in-flight snapshot changed")
	}
	newCtx, err := New(pool, cfg).Context(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if Int(newCtx, "query_days", 0) != 7 {
		t.Fatal("new process did not read persisted settings")
	}
	visible := Public(updated)
	if visible.Values["query_days"] != 7 || visible.Defaults != nil || visible.Fields != nil {
		t.Fatalf("bad public view: %+v", visible)
	}
	if _, ok := visible.Values["export_min_free_mb"]; ok {
		t.Fatal("internal disk setting leaked into public policy")
	}
	history, err := svc.History(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].Before["query_days"] != 21 || history[0].After["query_days"] != 7 {
		t.Fatalf("bad history: %+v", history)
	}
	var count int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM audit_logs WHERE action='system.settings.update' AND actor_admin_id=$1`, actor).Scan(&count); err != nil || count != 1 {
		t.Fatalf("audit not committed: %d %v", count, err)
	}
	for _, patch := range []Values{{"password_min_bytes": 30, "password_max_bytes": 20}, {"query_days": 0}, {"database_password": 1}, {"query_points": 500.0, "sms_ttl_seconds": 30, "sms_cooldown_seconds": 60}} {
		_, err = svc.Update(t.Context(), UpdateInput{Values: patch, Reason: "验证无效配置不能保存"}, Actor{ID: actor})
		if apperr.KindOf(err) != apperr.KindInvalidArgument {
			t.Fatalf("invalid patch accepted: %v %v", patch, err)
		}
	}
	after, err := svc.Load(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if after.Version != 1 || after.Values["query_days"] != 7 {
		t.Fatal("invalid update changed saved state")
	}
	// The widened node name column must actually accept a configured value beyond the old 50 characters.
	var tableType string
	if err = pool.QueryRow(t.Context(), `SELECT data_type FROM information_schema.columns WHERE table_name='node_profiles' AND column_name='name'`).Scan(&tableType); err != nil || tableType != "text" {
		t.Fatalf("node names still constrained by DB: %s %v", tableType, err)
	}
	if strings.TrimSpace(history[0].ActorName) == "" {
		t.Fatal("history missing administrator name")
	}
}
func TestSettingsMigrationDownUp(t *testing.T) {
	pool := testdb.Open(t, 0)
	testdb.Apply(t, pool, "../../migrations/000052_system_settings.down.sql")
	testdb.Apply(t, pool, "../../migrations/000052_system_settings.up.sql")
	if _, err := New(pool, config.Default()).Load(t.Context()); err != nil {
		t.Fatal(err)
	}
}
