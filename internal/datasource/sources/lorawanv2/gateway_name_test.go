package lorawanv2

import (
	"testing"

	"github.com/google/uuid"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/testdb"
)

func TestGatewaySyncPreservesPlatformName(t *testing.T) {
	db := testdb.Open(t, 0)
	admin := testdb.Admin(t, db)
	var sourceID uuid.UUID
	if err := db.QueryRow(t.Context(), `INSERT INTO data_sources(name,type,dsn_secret_ref,created_by) VALUES('test','http_api','TEST_ONLY',$1) RETURNING id`, admin).Scan(&sourceID); err != nil {
		t.Fatal(err)
	}
	svc := newTestService(db)
	gateway := LoRaWANV2Gateway{SN: "51EB7DD4BF7E6EFB198E", NodeCount: 2}
	source := sqlc.DataSource{ID: sourceID}
	first, err := svc.persistLoRaWANV2Gateway(t.Context(), source, gateway, nil, true, admin)
	if err != nil {
		t.Fatal(err)
	}
	if first.Device.Name != "LoRa 网关 "+gateway.SN {
		t.Fatalf("unexpected initial name: %s", first.Device.Name)
	}
	if _, err := db.Exec(t.Context(), `UPDATE devices SET name=$2 WHERE id=$1`, first.Device.ID, "桃花岛生长观测网关"); err != nil {
		t.Fatal(err)
	}
	gateway.NodeCount = 3
	for _, complete := range []bool{true, false, true} {
		result, err := svc.persistLoRaWANV2Gateway(t.Context(), source, gateway, nil, complete, admin)
		if err != nil {
			t.Fatal(err)
		}
		if result.Device.ID != first.Device.ID || result.Device.Name != "桃花岛生长观测网关" {
			t.Fatalf("sync replaced custom name: %s", result.Device.Name)
		}
	}
	var name, serial string
	if err := db.QueryRow(t.Context(), `SELECT name,serial_no FROM devices WHERE id=$1`, first.Device.ID).Scan(&name, &serial); err != nil {
		t.Fatal(err)
	}
	if name != "桃花岛生长观测网关" || serial != gateway.SN {
		t.Fatalf("name=%s serial=%s", name, serial)
	}
}
