package device

import (
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/testdb"
)

func TestNormalizeICCID(t *testing.T) {
	for _, value := range []string{"", "  ", "8986001234567890123", " 89860012345678901234 "} {
		if _, err := normalizeICCID(value); err != nil {
			t.Errorf("valid ICCID rejected: %v", err)
		}
	}
	for _, value := range []string{"123", "8986001234567890123x", "898600123456789012345"} {
		if _, err := normalizeICCID(value); err == nil {
			t.Error("invalid ICCID accepted")
		}
	}
}

func TestAdminCannotChangeProductIdentifier(t *testing.T) {
	product := "another-product"
	if _, err := NewService(nil).AdminUpdate(t.Context(), AdminUpdateInput{DeviceID: uuid.New(), ProductID: &product}); err == nil {
		t.Fatal("product identifier must not be editable after creation")
	}
}

func TestDeviceICCIDPersistence(t *testing.T) {
	db := testdb.Open(t, 0)
	service := NewService(db)
	for _, kind := range []string{"standalone", "gateway", "gateway_node", "camera", "carbon_sink"} {
		t.Run(kind, func(t *testing.T) {
			id := uuid.New()
			if _, err := db.Exec(t.Context(), "INSERT INTO devices(id,name,serial_no,device_type) VALUES($1,$2,$3,$2)", id, kind, id.String()); err != nil {
				t.Fatal(err)
			}
			iccid := "89860012345678901234"
			saved, err := service.AdminUpdate(t.Context(), AdminUpdateInput{DeviceID: id, ICCID: &iccid})
			if err != nil || saved.ICCID == nil || *saved.ICCID != iccid {
				t.Fatalf("ICCID save failed: %v", err)
			}
			name := "renamed"
			if _, err := service.AdminUpdate(t.Context(), AdminUpdateInput{DeviceID: id, Name: &name}); err != nil {
				t.Fatal(err)
			}
			loaded, err := service.GetAsset(t.Context(), id)
			if err != nil || loaded.ICCID == nil || *loaded.ICCID != iccid {
				t.Fatalf("ICCID not preserved: %v", err)
			}
			empty := ""
			cleared, err := service.AdminUpdate(t.Context(), AdminUpdateInput{DeviceID: id, ICCID: &empty})
			if err != nil || cleared.ICCID != nil {
				t.Fatalf("clear failed: %v", err)
			}
		})
	}
	testdb.Apply(t, db, "../../migrations/000041_device_iccid.down.sql")
	testdb.Apply(t, db, "../../migrations/000041_device_iccid.up.sql")
}
