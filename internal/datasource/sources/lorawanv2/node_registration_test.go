package lorawanv2

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestParseNodeCSV(t *testing.T) {
	for _, input := range []string{"\ufeffsn,node_index\r\n000123,3\r\nNODE-B,254\r\n", "000123,3\nNODE-B,254"} {
		rows, err := ParseNodeCSV(input)
		if err != nil || len(rows) != 2 || rows[0].SN != "000123" || rows[1].NodeIndex != 254 {
			t.Fatalf("CSV=%+v %v", rows, err)
		}
	}
	rows, err := ParseNodeCSV("sn,序号\nA,1\nA,2\nB,2\nC,255\nD,1.5\nE,1,extra")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.Error == "" {
			t.Fatalf("invalid CSV row accepted: %+v", r)
		}
	}
	for _, input := range []string{"", "sn,node_index\n", `"bad,3`, strings.Repeat("A,1\n", 255)} {
		if _, err := ParseNodeCSV(input); err == nil {
			t.Fatal("invalid or oversized CSV accepted")
		}
	}
}
func TestNewNodeRegistrationAndInstallationAreSeparateAndDoNotRescanMetrics(t *testing.T) {
	db := testdb.Open(t, 0)
	actor := testdb.Admin(t, db)
	ctx := t.Context()
	source, gateway, otherSource := uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []uuid.UUID{source, otherSource} {
		must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,$3,'http_api','lorawan_v2','secret:test',$2)`, id, actor, id.String())
	}
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'GW','gateway')`, gateway)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	nodes := map[string]PhysicalNode{}
	created := 0
	boundWrites := 0
	failBind := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var value any
		switch {
		case r.Method == "GET" && r.URL.Path == "/nodes":
			list := []PhysicalNode{}
			if n, ok := nodes[r.URL.Query().Get("sn")]; ok {
				list = append(list, n)
			}
			value = map[string]any{"data": list}
		case r.Method == "GET" && r.URL.Path == "/device/GW/nodes":
			list := []PhysicalNode{}
			for _, n := range nodes {
				if n.NodeIndex != nil {
					list = append(list, n)
				}
			}
			value = PhysicalNodes{GatewaySN: "GW", Data: list, BoundNodeCount: len(list)}
		case r.Method == "POST" && r.URL.Path == "/nodes":
			var body struct {
				SN string `json:"sn"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			created++
			n := PhysicalNode{ID: int64(created), SN: body.SN}
			nodes[n.SN] = n
			value = n
		case r.Method == "PUT" && strings.HasSuffix(r.URL.Path, "/binding"):
			boundWrites++
			if failBind {
				w.WriteHeader(500)
				fmt.Fprint(w, `{"success":false}`)
				return
			}
			sn := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/nodes/"), "/binding")
			var body struct {
				GatewaySN string `json:"gateway_sn"`
				Index     int    `json:"node_index"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			n := nodes[sn]
			n.GatewaySN = &body.GatewaySN
			n.NodeIndex = &body.Index
			nodes[sn] = n
			value = n
		default:
			t.Errorf("per-row operation must not scan sensor configs/metrics: %s", r.URL.Path)
			w.WriteHeader(500)
			return
		}
		raw, _ := json.Marshal(value)
		fmt.Fprintf(w, `{"success":true,"payload":%s}`, raw)
	}))
	defer server.Close()
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	for i := 1; i <= 2; i++ {
		result, err := s.RegisterPhysicalNode(ctx, source, actor, NodeRegistration{SN: "000" + strconv.Itoa(i), GatewayDeviceID: &gateway, NodeIndex: i})
		if err != nil || result.Status != "completed" || !result.Created || !result.Bound {
			t.Fatalf("new+install: %+v %v", result, err)
		}
	}
	if created != 2 || boundWrites != 2 {
		t.Fatal("wrong number of source writes")
	}
	before := created
	if _, err := s.RegisterPhysicalNode(ctx, source, actor, NodeRegistration{SN: "NEW", GatewayDeviceID: &gateway, NodeIndex: 1}); apperr.KindOf(err) != apperr.KindConflict || created != before {
		t.Fatal("occupied slot created a new node")
	}
	if _, err := s.RegisterPhysicalNode(ctx, source, actor, NodeRegistration{SN: "0001"}); apperr.KindOf(err) != apperr.KindConflict || created != before {
		t.Fatal("existing SN reused")
	}
	if _, err := s.RegisterPhysicalNode(ctx, otherSource, actor, NodeRegistration{SN: "CROSS", GatewayDeviceID: &gateway, NodeIndex: 3}); err == nil || created != before {
		t.Fatal("cross-source gateway accepted")
	}
	result, err := s.RegisterPhysicalNode(ctx, source, actor, NodeRegistration{SN: "STOCK"})
	if err != nil || !result.Created || result.Bound {
		t.Fatalf("standalone registration failed: %+v %v", result, err)
	}
	failBind = true
	result, err = s.RegisterPhysicalNode(ctx, source, actor, NodeRegistration{SN: "PARTIAL", GatewayDeviceID: &gateway, NodeIndex: 3})
	if err != nil || result.Status != "partial" || !result.Created || result.Bound {
		t.Fatalf("lost partial creation: %+v %v", result, err)
	}
	var unbound bool
	if err := db.QueryRow(ctx, `SELECT gateway_device_id IS NULL FROM lorawan_physical_nodes WHERE sn='PARTIAL'`).Scan(&unbound); err != nil || !unbound {
		t.Fatal("created unbound asset lost")
	}
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM data_streams WHERE device_id=$1`, gateway).Scan(&count); err != nil || count != 0 {
		t.Fatal("per-row registration rescanned metric catalog")
	}
}
