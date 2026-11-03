package platform

import (
	"database/sql/driver"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform/statisticstest"
)

func TestStatisticsIntervalOnlyTrustsFullDayUniformCaptureAndUpload(t *testing.T) {
	tests := []struct {
		capture, upload string
		want            int64
	}{
		{"0,30 *", "0 *", 3600},
		{"10,30,50 *", "0,30 *", 1800},
		{"0,10,30 *", "0 *", 0},
		{"0,30 8,9,10,11,12,13,14,15,16,17", "0 *", 0},
		{"0,30 *", "", 0},
		{"0,0 *", "0 *", 3600}, // duplicate cron entries denote one event
	}
	for _, tt := range tests {
		t.Run(tt.capture+"/"+tt.upload, func(t *testing.T) {
			raw, _ := json.Marshal(map[string]string{"data_capture_invl": tt.capture, "data_upload_invl": tt.upload})
			got := StatisticsInterval(raw)
			if tt.want == 0 {
				if got != nil {
					t.Fatalf("unknown plan=%d", *got)
				}
				return
			}
			if got == nil || *got != tt.want {
				t.Fatalf("got=%v want=%d", got, tt.want)
			}
		})
	}
	if StatisticsInterval([]byte(`{}`)) != nil {
		t.Fatal("defaulted missing schedule")
	}
}

func TestStatisticsConnectionPinsAndRestoresNumericTimezone(t *testing.T) {
	db := statisticstest.New(t,
		statisticstest.Step{Contains: []string{"SELECT @@session.time_zone"}, Columns: []string{"time_zone"}, Rows: [][]driver.Value{{"SYSTEM"}}},
		statisticstest.Step{Exec: true, Contains: []string{"SET SESSION time_zone = '+08:00'"}},
		statisticstest.Step{Exec: true, Contains: []string{"SET SESSION time_zone = ?"}, Args: []driver.Value{"SYSTEM"}},
	)
	_, cleanup, err := StatisticsConnection(t.Context(), db)
	if err != nil {
		t.Fatal(err)
	}
	cleanup()
}

func TestStatisticsBeijingDaysAreHalfOpenAndIdentityIsStable(t *testing.T) {
	// The requested midnight is still the previous UTC date.
	start := time.Date(2026, 9, 30, 16, 0, 0, 0, time.UTC)
	result := NewRecordStatistics("source", start, start.Add(48*time.Hour)).Result()
	if len(result.Days) != 2 || result.Days[0].Date != "2026-10-01" || result.Days[1].Date != "2026-10-02" {
		t.Fatalf("days=%+v", result.Days)
	}
	source := uuid.New()
	if ObservationIdentity(source, "thcpn", "42") != ObservationIdentity(source, "thcpn", "42") || ObservationIdentity(source, "thcpn", "42") == ObservationIdentity(uuid.New(), "thcpn", "42") {
		t.Fatal("unstable source identity")
	}
}
