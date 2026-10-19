package platform

import (
	"errors"
	"strings"
	"testing"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
)

func TestConfigWriteStagesAndRecovery(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, id := uuid.New(), uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon','mysql','carbon','env:NOT_USED',$2)`, source, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name) VALUES($1,'Carbon')`, id); err != nil {
		t.Fatal(err)
	}
	s := NewService(db)
	for _, tc := range []struct {
		name, status, source, platform string
		writeErr, applyErr             error
	}{
		{name: "success", status: "completed", source: "accepted", platform: "synced"},
		{name: "platform failure", status: "partial", source: "accepted", platform: "failed", applyErr: apperr.New(apperr.KindInternal, "platform unavailable")},
		{name: "rejected", status: "failed", source: "failed", platform: "pending", writeErr: errors.New("source rejected")},
		{name: "unknown commit", status: "unknown", source: "unknown", platform: "pending", writeErr: &UnknownSourceWrite{Err: errors.New("commit timeout")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writes, applies := 0, 0
			response, err := s.WriteConfig(ctx, source, UpdateDeviceConfigInput{DeviceID: id, ActorUserID: admin, ExpectedConfigID: 4}, func() (DeviceConfig, ConfigAudit, error) {
				writes++
				return DeviceConfig{ID: 5, DeviceID: 7}, ConfigAudit{PreviousConfigID: 4}, tc.writeErr
			}, func(config DeviceConfig) (UpdateDeviceConfigResult, error) {
				applies++
				if config.ID != 5 {
					t.Fatal("wrong accepted version")
				}
				return UpdateDeviceConfigResult{}, tc.applyErr
			})
			if (err != nil) != (tc.writeErr != nil) {
				t.Fatalf("unexpected outward error: %v", err)
			}
			if writes != 1 || applies != boolCount(tc.writeErr == nil) {
				t.Fatalf("writes=%d applies=%d", writes, applies)
			}
			state := response.WriteState
			if state == nil || state.Source != tc.source || state.Platform != tc.platform || state.Device != "unknown" {
				t.Fatalf("wrong state: %+v", state)
			}
			op, readErr := s.GetSourceOperation(ctx, state.OperationID)
			if readErr != nil || op.Status != tc.status {
				t.Fatalf("operation %+v: %v", op, readErr)
			}
			if tc.applyErr != nil {
				if response.Config.ID != 5 || len(response.Warnings) == 0 || !strings.Contains(op.Error, "platform unavailable") {
					t.Fatalf("lost partial result/error: %+v %+v", response, op)
				}
				if err := s.MarkConfigReconciled(ctx, id, 5); err != nil {
					t.Fatal(err)
				}
				recovered, err := s.GetSourceOperation(ctx, state.OperationID)
				if err != nil || recovered.Status != "reconciled" {
					t.Fatalf("recovery: %+v %v", recovered, err)
				}
				if writes != 1 {
					t.Fatal("recovery repeated external write")
				}
			}
		})
	}
}
func boolCount(v bool) int {
	if v {
		return 1
	}
	return 0
}
