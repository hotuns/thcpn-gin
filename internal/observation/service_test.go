package observation

import (
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestWindowBoundaryAndLegacy(t *testing.T) {
	cutoff := time.Date(2026, 11, 1, 8, 0, 0, 0, time.UTC)
	start, end := cutoff.Add(-time.Hour), cutoff.Add(time.Hour)
	a, b, ok := Clip(Formal, &cutoff, start, end)
	if !ok || !a.Equal(cutoff) || !b.Equal(end) {
		t.Fatal("formal window must start inclusively at boundary")
	}
	a, b, ok = Clip(Testing, &cutoff, start, end)
	if !ok || !a.Equal(start) || !b.Before(cutoff) {
		t.Fatal("testing must end before boundary")
	}
	_, _, ok = Clip(Formal, &cutoff, start, cutoff.Add(-time.Minute))
	if ok {
		t.Fatal("entirely test range queried as formal")
	}
	_, _, ok = Clip(Testing, &cutoff, cutoff, end)
	if ok {
		t.Fatal("formal data included in testing")
	}
	_, _, ok = Clip(Formal, nil, start, end)
	if !ok {
		t.Fatal("legacy unclassified data hidden")
	}
	_, _, ok = Clip(Testing, nil, start, end)
	if ok {
		t.Fatal("unclassified legacy data treated as testing")
	}
	a, b, ok = Clip(All, &cutoff, start, end)
	if !ok || a != start || b != end {
		t.Fatal("admin all altered")
	}
}
func TestNodeOverrideInheritanceAndHistory(t *testing.T) {
	db := testdb.Open(t, 0)
	testdb.Apply(t, db, "../../migrations/000051_observation_start.down.sql")
	testdb.Apply(t, db, "../../migrations/000051_observation_start.up.sql")
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	device := uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')", device); err != nil {
		t.Fatal(err)
	}
	svc := Service{DB: db}
	base := time.Now().UTC().Truncate(time.Second)
	node := base.Add(time.Hour)
	if err := svc.Set(ctx, device, actor, 0, &base, "Installation"); err != nil {
		t.Fatal(err)
	}
	inherited, err := svc.DeviceStart(ctx, device, 3)
	if err != nil || inherited == nil || !inherited.Equal(base) {
		t.Fatalf("inheritance: %v", err)
	}
	if err = svc.Set(ctx, device, actor, 3, &node, "Node 3 installed later"); err != nil {
		t.Fatal(err)
	}
	got, err := svc.DeviceStart(ctx, device, 3)
	if err != nil || got == nil || !got.Equal(node) {
		t.Fatal("node override missing")
	}
	if err = svc.Set(ctx, device, actor, 3, nil, "Use gateway default"); err != nil {
		t.Fatal(err)
	}
	got, err = svc.DeviceStart(ctx, device, 3)
	if err != nil || got == nil || !got.Equal(base) {
		t.Fatal("node clear did not restore inheritance")
	}
	_, events, err := svc.List(ctx, device, true)
	if err != nil || len(events) != 3 || events[0].Previous == nil || events[0].StartsAt != nil || events[0].Actor == "" {
		t.Fatalf("audit history: %d %v", len(events), err)
	}
	_, events, err = svc.List(ctx, device, false)
	if err != nil || len(events) != 0 {
		t.Fatal("user received operator history")
	}
}
func TestStreamWindowResolvesLoRaNodeBoundary(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	device, source, stream := uuid.New(), uuid.New(), uuid.New()
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	must("INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')", device)
	must("INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)", source, actor)
	must("INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,'node3','Node 3','telemetry',$3,'system_admin')", stream, device, actor)
	must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,adapter_code,adapter_config_json,payload_type,created_by,created_by_type) VALUES($1,$2,'lorawan_v2','{"node_index":3}','json',$3,'system_admin')`, stream, source, actor)
	svc := Service{DB: db}
	start := time.Now().UTC().Truncate(time.Second)
	cutoff := start.Add(time.Hour)
	end := cutoff.Add(time.Hour)
	if err := svc.Set(ctx, device, actor, 3, &cutoff, "Node 3 deployed"); err != nil {
		t.Fatal(err)
	}
	from, _, ok, err := svc.StreamWindow(ctx, stream, start, end)
	if err != nil || !ok || !from.Equal(cutoff) {
		t.Fatalf("node stream cutoff not resolved: %v", err)
	}
	from, _, ok, err = svc.StreamWindow(WithPhase(ctx, All), stream, start, end)
	if err != nil || !ok || !from.Equal(start) {
		t.Fatal("administrator all window clipped")
	}
}
