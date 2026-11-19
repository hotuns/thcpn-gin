package lorawanv2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestPhysicalNodeListReadsPlatformWhileGatewaySyncIsLocked(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	source, otherSource, gateway, otherGateway, emptyGateway := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []uuid.UUID{source, otherSource} {
		must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by)
			VALUES($1,$3,'http_api','lorawan_v2','secret:test',$2)`, id, actor, id.String())
	}
	for _, id := range []uuid.UUID{gateway, otherGateway, emptyGateway} {
		must(`INSERT INTO devices(id,name,device_type) VALUES($1,$2,'gateway')`, id, id.String())
	}
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key)
		VALUES($1,$2,'lorawan_v2','GW'),($3,$4,'lorawan_v2','OTHER'),($5,$2,'lorawan_v2','EMPTY')`, gateway, source, otherGateway, otherSource, emptyGateway)
	must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index)
		VALUES($1,9,'NODE-9',$2,9),($1,3,'NODE-3',$2,3),($1,90,'STOCK',NULL,NULL),($3,3,'OTHER-NODE',$4,3)`, source, gateway, otherSource, otherGateway)
	must(`INSERT INTO lorawan_legacy_nodes(gateway_device_id,node_index) VALUES($1,55)`, gateway)
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	s := newTestService(db)
	secret, err := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	unlock, err := s.LockSourceSync(ctx, source.String()+"/lorawan_v2/GW")
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	var before string
	if err := db.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM lorawan_physical_nodes p`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	nodes, err := s.ListPhysicalNodes(readCtx, gateway)
	if err != nil {
		t.Fatalf("cached listing waited for synchronization or contacted unavailable source: %v", err)
	}
	if nodes.GatewaySN != "GW" || nodes.BoundNodeCount != 2 || len(nodes.Data) != 2 {
		t.Fatalf("unexpected platform node directory: %+v", nodes)
	}
	for i, expected := range []struct {
		id    int64
		sn    string
		index int
	}{{3, "NODE-3", 3}, {9, "NODE-9", 9}} {
		node := nodes.Data[i]
		if node.ID != expected.id || node.SN != expected.sn || node.NodeIndex == nil || *node.NodeIndex != expected.index || node.GatewaySN == nil || *node.GatewaySN != "GW" {
			t.Fatalf("unexpected physical node at position %d: %+v", i, node)
		}
	}
	empty, err := s.ListPhysicalNodes(readCtx, emptyGateway)
	if err != nil || empty.GatewaySN != "EMPTY" || empty.BoundNodeCount != 0 || empty.Data == nil || len(empty.Data) != 0 {
		t.Fatalf("empty platform directory must retain its response contract: %+v %v", empty, err)
	}
	if calls.Load() != 0 {
		t.Fatalf("platform listing made %d source HTTP requests", calls.Load())
	}
	var after string
	if err := db.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM lorawan_physical_nodes p`).Scan(&after); err != nil || before != after {
		t.Fatalf("platform listing changed cached bindings or timestamps: %v", err)
	}
	var legacyCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM lorawan_legacy_nodes WHERE gateway_device_id=$1 AND node_index=55`, gateway).Scan(&legacyCount); err != nil || legacyCount != 1 {
		t.Fatalf("physical-node listing changed explicit legacy positions: %d %v", legacyCount, err)
	}
}
