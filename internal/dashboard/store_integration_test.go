package dashboard

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/testdb"
)

func TestPostgresStatisticsRevisionAndAlertScope(t *testing.T) {
	pool := testdb.Open(t, 0)
	repo := postgresRepository{db: pool}
	ctx := t.Context()
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	admin := testdb.Admin(t, pool)
	user, workspace, source, first, second := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	mustExec(`INSERT INTO users(id,name,email) VALUES($1,'Dashboard test','dashboard@test.invalid')`, user)
	mustExec(`INSERT INTO workspaces(id,type,organization_type,name,owner_user_id) VALUES($1,'organization','lab','Dashboard test',$2)`, workspace, user)
	mustExec(`INSERT INTO data_sources(id,name,type,dsn_secret_ref,created_by) VALUES($1,'Dashboard test','mysql','UNUSED_DASHBOARD_TEST_SOURCE',$2)`, source, admin)
	for _, id := range []uuid.UUID{first, second} {
		mustExec(`INSERT INTO devices(id,name,device_type) VALUES($1,'Dashboard station','standalone')`, id)
		rule := uuid.New()
		mustExec(`INSERT INTO alert_rules(id,workspace_id,name,type,severity,device_id,offline_after_seconds,created_by) VALUES($1,$2,'Offline test','device_offline','warning',$3,3600,$4)`, rule, workspace, id, user)
		mustExec(`INSERT INTO alert_events(rule_id,workspace_id,device_id,severity,title,content) VALUES($1,$2,$3,'warning','Offline test','Test')`, rule, workspace, id)
	}
	mustExec(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'thcpn_legacy_mysql','123')`, first, source)
	version := func() string {
		t.Helper()
		versions, err := repo.Revisions(ctx, []uuid.UUID{first})
		if err != nil {
			t.Fatal(err)
		}
		if versions[first] == "" {
			t.Fatal("missing revision")
		}
		return versions[first]
	}
	initial := version()
	mustExec(`INSERT INTO device_observation_starts(device_id,node_index,starts_at,updated_by) VALUES($1,0,$2,$3)`, first, time.Now().Add(-24*time.Hour), admin)
	if version() == initial {
		t.Fatal("adding a formal observation cutoff must invalidate cached counts")
	}
	mustExec(`DELETE FROM device_observation_starts WHERE device_id=$1`, first)
	if version() != initial {
		t.Fatal("removing a cutoff must restore the original semantic revision")
	}
	mustExec(`UPDATE device_source_refs SET external_key='456' WHERE device_id=$1`, first)
	if version() == initial {
		t.Fatal("rebinding a physical source must invalidate cached counts")
	}
	beforeSnapshot := version()
	mustExec(`INSERT INTO lorawan_v2_node_config_snapshots(device_id,node_index,content_hash,wait_time,content_json,metrics_json,management_status) VALUES($1,254,'history',0,'{}','[]','unmanaged')`, first)
	withSnapshot := version()
	if withSnapshot == beforeSnapshot {
		t.Fatal("a historical node position must invalidate cached counts")
	}
	mustExec(`INSERT INTO lorawan_v2_node_config_snapshots(device_id,node_index,content_hash,wait_time,content_json,metrics_json,management_status) VALUES($1,254,'new-version',0,'{}','[]','unmanaged')`, first)
	if version() != withSnapshot {
		t.Fatal("another configuration at the same position does not add observations")
	}
	if count, err := repo.ActiveAlerts(ctx, workspace, []uuid.UUID{first}); err != nil || count != 1 {
		t.Fatalf("only authorized device alerts should count: count=%d err=%v", count, err)
	}
	if count, err := repo.ActiveAlerts(ctx, uuid.New(), []uuid.UUID{first}); err != nil || count != 0 {
		t.Fatalf("alerts must also belong to the requested workspace: count=%d err=%v", count, err)
	}
}
