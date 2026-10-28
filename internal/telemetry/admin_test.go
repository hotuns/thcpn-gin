package telemetry

import (
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestAdministratorQueriesUnassignedDeviceWithoutSubscription(t *testing.T) {
	db := testdb.Open(t, 0)
	id := uuid.New()
	if _, err := db.Exec(t.Context(), `INSERT INTO devices(id,name,device_type) VALUES($1,'Unassigned device','standalone')`, id); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db, nil, nil, config.QueryLimitsConfig{MaxHistoryDays: 31, MaxPoints: 5000})
	svc.billing = &billing.Service{}
	input := QueryInput{DeviceID: &id, StartTime: time.Now().Add(-time.Hour), EndTime: time.Now(), Limit: 100}
	result, err := svc.QueryAdmin(t.Context(), input)
	if err != nil || result.DeviceID != id {
		t.Fatalf("administrator query: %v", err)
	}
	if _, err = svc.Query(t.Context(), input); err == nil {
		t.Fatal("user query must retain assignment/history checks")
	}
	input.EndTime = input.StartTime
	if _, err = svc.QueryAdmin(t.Context(), input); err == nil {
		t.Fatal("administrator queries still need a valid range")
	}
}
