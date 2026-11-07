package alerting

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/config"
	"thcpn-gin/internal/notification"
	"thcpn-gin/internal/systemsettings"
	"thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/testdb"
)

type scanTelemetryReader func(context.Context, telemetry.QueryInput) (telemetry.QueryResult, error)

func (f scanTelemetryReader) QueryInternal(ctx context.Context, input telemetry.QueryInput) (telemetry.QueryResult, error) {
	return f(ctx, input)
}

type deliveryTestMailer struct{ messages []AlertEmail }

func (m *deliveryTestMailer) SendAlert(_ context.Context, message AlertEmail) error {
	m.messages = append(m.messages, message)
	return nil
}

type deliveryTestNotifier struct{ messages []notification.SendInput }

func (n *deliveryTestNotifier) SendToUser(_ context.Context, _, _ uuid.UUID, message notification.SendInput) error {
	n.messages = append(n.messages, message)
	return nil
}

func TestAlertEmailUsesCurrentDeploymentURL(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	userID, workspaceID, deviceID, ruleID, eventID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	mustExec(`INSERT INTO users(id,name,email,email_verified_at) VALUES($1,'Delivery test','delivery@test.invalid',now())`, userID)
	mustExec(`INSERT INTO workspaces(id,type,organization_type,name,owner_user_id) VALUES($1,'organization','lab','Delivery test',$2)`, workspaceID, userID)
	mustExec(`INSERT INTO devices(id,name,device_type) VALUES($1,'Delivery device','standalone')`, deviceID)
	mustExec(`INSERT INTO alert_rules(id,workspace_id,name,type,severity,device_id,offline_after_seconds,channels,created_by) VALUES($1,$2,'Offline test','device_offline','warning',$3,600,ARRAY['in_app','email'],$4)`, ruleID, workspaceID, deviceID, userID)
	mustExec(`INSERT INTO alert_events(id,rule_id,workspace_id,device_id,severity,title,content) VALUES($1,$2,$3,$4,'warning','Device offline','No recent readings')`, eventID, ruleID, workspaceID, deviceID)
	mustExec(`INSERT INTO alert_deliveries(event_id,user_id,channel,kind) VALUES($1,$2,'email','triggered'),($1,$2,'in_app','triggered')`, eventID, userID)
	mustExec(`INSERT INTO system_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING`)
	cfg := config.Default()
	cfg.Deployment.PublicBaseURL = "https://startup.example"
	mailer, notifier := &deliveryTestMailer{}, &deliveryTestNotifier{}
	evaluator := NewEvaluator(db, nil, nil, notifier, mailer)
	evaluator.SetSettings(systemsettings.New(db, cfg))
	path := "/alerts?event=" + eventID.String()
	for _, tc := range []struct {
		name, stored, want string
	}{
		{"startup setting", "", "https://startup.example"},
		{"configured public domain", "https://ieswatch.com", "https://ieswatch.com"},
		{"changed without worker restart", "http://site.lan:8088", "http://site.lan:8088"},
		{"restored startup setting", "", "https://startup.example"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mustExec(`UPDATE system_settings SET public_base_url=NULLIF($1,'') WHERE singleton=true`, tc.stored)
			mustExec(`UPDATE alert_deliveries SET status='pending',attempts=0,next_attempt_at=now()`)
			mailer.messages, notifier.messages = nil, nil
			if err := evaluator.deliver(ctx, 10); err != nil {
				t.Fatal(err)
			}
			if len(mailer.messages) != 1 || mailer.messages[0].ActionURL != tc.want+path {
				t.Fatalf("email action: %+v, want %s", mailer.messages, tc.want+path)
			}
			if len(notifier.messages) != 1 || notifier.messages[0].ActionURL != path {
				t.Fatalf("in-app action: %+v, want %s", notifier.messages, path)
			}
		})
	}

	// An installation with no public address sends the alert text, not a broken
	// relative link that a mail client would try to open outside the application.
	evaluator.SetSettings(systemsettings.New(db, config.Default()))
	mustExec(`UPDATE alert_deliveries SET status='pending',attempts=0,next_attempt_at=now()`)
	mailer.messages = nil
	if err := evaluator.deliver(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if len(mailer.messages) != 1 || mailer.messages[0].ActionURL != "" || mailer.messages[0].Content != "No recent readings" {
		t.Fatalf("unconfigured domain email: %+v", mailer.messages)
	}
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
