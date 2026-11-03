package alerting

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/testdb"
)

type scanTelemetryReader func(context.Context, telemetry.QueryInput) (telemetry.QueryResult, error)

func (f scanTelemetryReader) QueryInternal(ctx context.Context, input telemetry.QueryInput) (telemetry.QueryResult, error) {
	return f(ctx, input)
}

type scanProfessionalGate func(context.Context, uuid.UUID) error

func (f scanProfessionalGate) RequireProfessional(ctx context.Context, workspaceID uuid.UUID) error {
	return f(ctx, workspaceID)
}

func TestEvaluatorRotatesAcrossBatches(t *testing.T) {
	for _, scenario := range []string{"successful evaluations", "telemetry errors", "ineligible workspace"} {
		t.Run(scenario, func(t *testing.T) {
			db := testdb.Open(t, 0)
			ctx := t.Context()
			mustExec := func(query string, args ...any) {
				t.Helper()
				if _, err := db.Exec(ctx, query, args...); err != nil {
					t.Fatal(err)
				}
			}
			userID := uuid.New()
			firstWorkspace, secondWorkspace := uuid.New(), uuid.New()
			mustExec(`INSERT INTO users(id,name,email) VALUES($1,'Alert scan test','alert-scan@test.invalid')`, userID)
			for _, id := range []uuid.UUID{firstWorkspace, secondWorkspace} {
				mustExec(`INSERT INTO workspaces(id,type,organization_type,name,owner_user_id) VALUES($1,'organization','lab','Alert scan test',$2)`, id, userID)
			}

			firstDevices := map[uuid.UUID]bool{}
			inactiveDevices := map[uuid.UUID]bool{}
			for i := 0; i < 47; i++ {
				deviceID, streamID := uuid.New(), uuid.New()
				ruleID := uuid.MustParse(fmt.Sprintf("00000000-0000-0000-0000-%012d", i+1))
				workspaceID := secondWorkspace
				if i < 20 {
					workspaceID = firstWorkspace
					firstDevices[deviceID] = true
				}
				if i >= 45 {
					inactiveDevices[deviceID] = true
				}
				mustExec(`INSERT INTO devices(id,name,device_type) VALUES($1,'Alert scan device','standalone')`, deviceID)
				mustExec(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,'temperature','Temperature','telemetry',$3,'user')`, streamID, deviceID, userID)
				mustExec(`INSERT INTO alert_rules(id,workspace_id,name,type,severity,device_id,data_stream_id,condition_mode,upper_value,duration_seconds,created_by,enabled,archived_at,updated_at)
					VALUES($1,$2,'Alert scan rule','telemetry_threshold','warning',$3,$4,'above',20,0,$5,$6,CASE WHEN $7 THEN now() END,$8)`,
					ruleID, workspaceID, deviceID, streamID, userID, i != 45, i == 46, time.Date(2025, 1, 1, 0, i, 0, 0, time.UTC))
				mustExec(`INSERT INTO alert_evaluation_states(rule_id) VALUES($1)`, ruleID)
			}

			recovered := false
			reader := scanTelemetryReader(func(_ context.Context, input telemetry.QueryInput) (telemetry.QueryResult, error) {
				if inactiveDevices[*input.DeviceID] {
					t.Fatal("disabled or archived rule was evaluated")
				}
				if !recovered && scenario == "telemetry errors" && firstDevices[*input.DeviceID] {
					return telemetry.QueryResult{}, errors.New("source unavailable")
				}
				return telemetry.QueryResult{Series: []telemetry.Series{{Points: []telemetry.Point{{Timestamp: time.Now().UTC(), Value: 21}}}}}, nil
			})
			gate := scanProfessionalGate(func(_ context.Context, workspaceID uuid.UUID) error {
				if !recovered && scenario == "ineligible workspace" && workspaceID == firstWorkspace {
					return errors.New("professional plan required")
				}
				return nil
			})
			scan := func() {
				t.Helper()
				// Recreate the evaluator so progress must survive worker restarts.
				evaluator := NewEvaluator(db, reader, gate, nil, nil)
				processed, err := evaluator.ProcessAvailable(ctx, 20)
				if err != nil || processed > 20 {
					t.Fatalf("processed=%d err=%v", processed, err)
				}
			}
			for i := 0; i < 3; i++ {
				scan()
			}
			var attempted, events, inactiveAttempts int
			if err := db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE r.enabled AND r.archived_at IS NULL), count(*) FILTER (WHERE NOT r.enabled OR r.archived_at IS NOT NULL) FROM alert_evaluation_states s JOIN alert_rules r ON r.id=s.rule_id WHERE s.last_evaluated_at IS NOT NULL`).Scan(&attempted, &inactiveAttempts); err != nil {
				t.Fatal(err)
			}
			if attempted != 45 || inactiveAttempts != 0 {
				t.Fatalf("after three batches: attempted=%d, want 45; inactive attempts=%d, want 0", attempted, inactiveAttempts)
			}
			if err := db.QueryRow(ctx, `SELECT count(*) FROM alert_events WHERE resolved_at IS NULL`).Scan(&events); err != nil {
				t.Fatal(err)
			}
			wantEvents := 45
			if scenario != "successful evaluations" {
				wantEvents = 25
			}
			if events != wantEvents {
				t.Fatalf("open events=%d, want %d", events, wantEvents)
			}

			// Skipped and failed rules remain eligible for future scans.
			recovered = true
			for i := 0; i < 3; i++ {
				scan()
			}
			if err := db.QueryRow(ctx, `SELECT count(*) FROM alert_events WHERE resolved_at IS NULL`).Scan(&events); err != nil {
				t.Fatal(err)
			}
			if events != 45 {
				t.Fatalf("open events after recovery=%d, want 45", events)
			}
		})
	}
}
