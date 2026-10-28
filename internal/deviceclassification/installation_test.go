package deviceclassification

import (
	"context"
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/testdb"
)

func TestManualInstallationMapDoesNotRequireSourceAvailability(t *testing.T) {
	db := testdb.Open(t, 0)
	id := uuid.New()
	ctx := t.Context()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Installation','standalone')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO device_profiles(device_id,latitude,longitude) VALUES($1,40.1,116.2)`, id); err != nil {
		t.Fatal(err)
	}
	called := false
	svc := NewService(db, func(context.Context, []uuid.UUID) (map[uuid.UUID]SourceLocation, error) {
		called = true
		return nil, nil
	})
	result, err := svc.Map(ctx, nil, false)
	if err != nil || len(result.Items) != 1 {
		t.Fatalf("map: %#v %v", result, err)
	}
	if called {
		t.Fatal("source lookup should be skipped for an explicit installation position")
	}
	if result.Items[0].LocationSource != "device" || result.Items[0].Latitude == nil || *result.Items[0].Latitude != 40.1 {
		t.Fatalf("installation position missing: %#v", result.Items[0])
	}
}
