package alerting

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/notification"
	"thcpn-gin/internal/telemetry"
)

type TelemetryReader interface {
	QueryInternal(context.Context, telemetry.QueryInput) (telemetry.QueryResult, error)
}

type UserNotifier interface {
	SendToUser(context.Context, uuid.UUID, uuid.UUID, notification.SendInput) error
}

type AlertEmail struct {
	To, Subject, Title, Content, ActionURL string
}

type Mailer interface {
	SendAlert(context.Context, AlertEmail) error
}

type Evaluator struct {
	db        *pgxpool.Pool
	telemetry TelemetryReader
	billing   ProfessionalGate
	notifier  UserNotifier
	mailer    Mailer
	now       func() time.Time
}

func NewEvaluator(db *pgxpool.Pool, reader TelemetryReader, gate ProfessionalGate, notifier UserNotifier, mailer Mailer) *Evaluator {
	return &Evaluator{db: db, telemetry: reader, billing: gate, notifier: notifier, mailer: mailer, now: func() time.Time { return time.Now().UTC() }}
}

type evaluationRule struct {
	ID, WorkspaceID, DeviceID uuid.UUID
	DataStreamID              *uuid.UUID
	Name, Type, Severity      string
	Mode                      *string
	Lower, Upper              *float64
	Duration                  int
	Delta                     float64
	OfflineAfter              *int
	Channels                  []string
}

type observation struct {
	value                *float64
	at                   *time.Time
	violating, recovered bool
}

func (e *Evaluator) ProcessAvailable(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := e.db.Query(ctx, `SELECT id,workspace_id,device_id,data_stream_id,name,type,severity,condition_mode,lower_value,upper_value,duration_seconds,recovery_delta,offline_after_seconds,channels FROM alert_rules WHERE enabled AND archived_at IS NULL ORDER BY updated_at LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	var rules []evaluationRule
	for rows.Next() {
		var r evaluationRule
		if err := rows.Scan(&r.ID, &r.WorkspaceID, &r.DeviceID, &r.DataStreamID, &r.Name, &r.Type, &r.Severity, &r.Mode, &r.Lower, &r.Upper, &r.Duration, &r.Delta, &r.OfflineAfter, &r.Channels); err != nil {
			rows.Close()
			return 0, err
		}
		rules = append(rules, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	processed := 0
	for _, r := range rules {
		if e.billing != nil && e.billing.RequireProfessional(ctx, r.WorkspaceID) != nil {
			continue
		}
		obs, err := e.observe(ctx, r)
		if err != nil {
			_, _ = e.db.Exec(ctx, `UPDATE alert_evaluation_states SET last_evaluated_at=now(),last_error=$2,updated_at=now() WHERE rule_id=$1`, r.ID, truncate(err.Error(), 1000))
			continue
		}
		if err = e.apply(ctx, r, obs); err != nil {
			return processed, err
		}
		processed++
	}
	if err := e.deliver(ctx, 100); err != nil {
		return processed, err
	}
	return processed, nil
}

func (e *Evaluator) observe(ctx context.Context, r evaluationRule) (observation, error) {
	now := e.now()
	start := now.Add(-30 * 24 * time.Hour)
	input := telemetry.QueryInput{DeviceID: &r.DeviceID, StartTime: start, EndTime: now, Limit: 1}
	if r.Type == TypeThreshold {
		input.DataStreamID = r.DataStreamID
	}
	result, err := e.telemetry.QueryInternal(ctx, input)
	if err != nil {
		return observation{}, err
	}
	var latest *telemetry.Point
	for _, series := range result.Series {
		if series.Error != "" {
			return observation{}, fmt.Errorf("telemetry stream: %s", series.Error)
		}
		for i := range series.Points {
			p := series.Points[i]
			if latest == nil || p.Timestamp.After(latest.Timestamp) {
				copy := p
				latest = &copy
			}
		}
	}
	if r.Type == TypeOffline {
		if latest == nil {
			return observation{violating: true, recovered: false}, nil
		}
		threshold := time.Duration(*r.OfflineAfter) * time.Second
		return observation{at: &latest.Timestamp, violating: now.Sub(latest.Timestamp) > threshold, recovered: now.Sub(latest.Timestamp) <= threshold}, nil
	}
	if latest == nil {
		return observation{}, fmt.Errorf("no telemetry value available")
	}
	v := latest.Value
	violating, recovered := thresholdState(*r.Mode, v, r.Lower, r.Upper, r.Delta)
	return observation{value: &v, at: &latest.Timestamp, violating: violating, recovered: recovered}, nil
}

func thresholdState(mode string, value float64, lower, upper *float64, delta float64) (bool, bool) {
	switch mode {
	case "above":
		return value > *upper, value <= *upper-delta
	case "below":
		return value < *lower, value >= *lower+delta
	case "outside":
		return value < *lower || value > *upper, value >= *lower+delta && value <= *upper-delta
	}
	return false, false
}

func (e *Evaluator) apply(ctx context.Context, r evaluationRule, obs observation) error {
	tx, err := e.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var state string
	var pending *time.Time
	err = tx.QueryRow(ctx, `SELECT state,pending_since FROM alert_evaluation_states WHERE rule_id=$1 FOR UPDATE`, r.ID).Scan(&state, &pending)
	if err != nil {
		return err
	}
	now := e.now()
	if state == "normal" && obs.violating {
		since := now
		if r.Type == TypeOffline && obs.at != nil {
			since = *obs.at
		}
		pending = &since
		state = "pending"
	}
	if state == "pending" {
		wait := time.Duration(r.Duration) * time.Second
		if r.Type == TypeOffline {
			if obs.at == nil {
				wait = time.Duration(*r.OfflineAfter) * time.Second
			} else {
				wait = 0
			}
		}
		if !obs.violating {
			state = "normal"
			pending = nil
		} else if pending != nil && now.Sub(*pending) >= wait {
			eventID, err := e.openEvent(ctx, tx, r, obs, now)
			if err != nil {
				return err
			}
			if err = e.queueDeliveries(ctx, tx, r, eventID, "triggered"); err != nil {
				return err
			}
			state = "firing"
		}
	}
	if state == "firing" && obs.recovered {
		var eventID uuid.UUID
		err := tx.QueryRow(ctx, `UPDATE alert_events SET resolved_at=$2,resolved_value=$3 WHERE rule_id=$1 AND resolved_at IS NULL RETURNING id`, r.ID, now, obs.value).Scan(&eventID)
		if err != nil && !isNoRows(err) {
			return err
		}
		if err == nil {
			if err = e.queueDeliveries(ctx, tx, r, eventID, "resolved"); err != nil {
				return err
			}
		}
		state = "normal"
		pending = nil
	}
	_, err = tx.Exec(ctx, `UPDATE alert_evaluation_states SET state=$2,pending_since=$3,last_evaluated_at=$4,last_observed_at=$5,last_value=$6,last_error=NULL,updated_at=$4 WHERE rule_id=$1`, r.ID, state, pending, now, obs.at, obs.value)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (e *Evaluator) openEvent(ctx context.Context, tx pgx.Tx, r evaluationRule, obs observation, now time.Time) (uuid.UUID, error) {
	title := fmt.Sprintf("%s预警：%s", map[string]string{"warning": "普通", "critical": "严重"}[r.Severity], r.Name)
	content := eventContent(r, obs)
	raw, _ := json.Marshal(r)
	var id uuid.UUID
	err := tx.QueryRow(ctx, `INSERT INTO alert_events(rule_id,workspace_id,device_id,data_stream_id,severity,title,content,trigger_value,trigger_observed_at,rule_snapshot,triggered_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(rule_id) WHERE resolved_at IS NULL DO UPDATE SET rule_id=EXCLUDED.rule_id RETURNING id`, r.ID, r.WorkspaceID, r.DeviceID, r.DataStreamID, r.Severity, title, content, obs.value, obs.at, raw, now).Scan(&id)
	return id, err
}

func eventContent(r evaluationRule, obs observation) string {
	if r.Type == TypeOffline {
		return fmt.Sprintf("设备超过 %d 分钟没有遥测数据", *r.OfflineAfter/60)
	}
	if obs.value == nil {
		return r.Name
	}
	return fmt.Sprintf("最新值 %.4g 已持续满足预警条件", *obs.value)
}

func (e *Evaluator) queueDeliveries(ctx context.Context, tx pgx.Tx, r evaluationRule, eventID uuid.UUID, kind string) error {
	_, err := tx.Exec(ctx, `INSERT INTO alert_deliveries(event_id,user_id,channel,kind) SELECT $1,rr.user_id,c,$2 FROM alert_rule_recipients rr CROSS JOIN unnest($3::text[]) c WHERE rr.rule_id=$4 ON CONFLICT(event_id,user_id,channel,kind) DO NOTHING`, eventID, kind, r.Channels, r.ID)
	return err
}

func (e *Evaluator) deliver(ctx context.Context, limit int) error {
	rows, err := e.db.Query(ctx, `SELECT d.id,d.event_id,d.user_id,d.channel,d.kind,d.attempts,e.workspace_id,e.title,e.content,e.severity,e.device_id,u.email,u.email_verified_at FROM alert_deliveries d JOIN alert_events e ON e.id=d.event_id JOIN users u ON u.id=d.user_id WHERE d.status IN ('pending','failed') AND d.attempts<5 AND d.next_attempt_at<=now() ORDER BY d.created_at LIMIT $1`, limit)
	if err != nil {
		return err
	}
	defer rows.Close()
	type delivery struct {
		id, eventID, userID, workspaceID, deviceID uuid.UUID
		channel, kind, title, content, severity    string
		attempts                                   int
		email                                      *string
		verified                                   *time.Time
	}
	var list []delivery
	for rows.Next() {
		var d delivery
		if err := rows.Scan(&d.id, &d.eventID, &d.userID, &d.channel, &d.kind, &d.attempts, &d.workspaceID, &d.title, &d.content, &d.severity, &d.deviceID, &d.email, &d.verified); err != nil {
			return err
		}
		list = append(list, d)
	}
	for _, d := range list {
		action := fmt.Sprintf("/alerts?event=%s", d.eventID)
		level := "warning"
		if d.severity == "critical" {
			level = "error"
		}
		title := d.title
		if d.kind == "resolved" {
			title = "已恢复：" + title
		}
		var sendErr error
		skipped := false
		if d.channel == "in_app" {
			if e.notifier == nil {
				sendErr = fmt.Errorf("notification service is unavailable")
			} else {
				sendErr = e.notifier.SendToUser(ctx, d.userID, d.workspaceID, notification.SendInput{Category: "device", Level: level, Title: title, Content: d.content, ActionURL: action})
			}
		} else if d.email == nil || d.verified == nil {
			skipped = true
		} else if e.mailer == nil {
			sendErr = fmt.Errorf("SMTP is not configured")
		} else {
			sendErr = e.mailer.SendAlert(ctx, AlertEmail{To: *d.email, Subject: title, Title: title, Content: d.content, ActionURL: action})
		}
		if skipped {
			_, err = e.db.Exec(ctx, `UPDATE alert_deliveries SET status='skipped',last_error='recipient has no verified email',updated_at=now() WHERE id=$1`, d.id)
		} else if sendErr == nil {
			_, err = e.db.Exec(ctx, `UPDATE alert_deliveries SET status='sent',attempts=attempts+1,sent_at=now(),last_error=NULL,updated_at=now() WHERE id=$1`, d.id)
		} else {
			delay := retryDelay(d.attempts + 1)
			_, err = e.db.Exec(ctx, `UPDATE alert_deliveries SET status='failed',attempts=attempts+1,next_attempt_at=now()+$2::interval,last_error=$3,updated_at=now() WHERE id=$1`, d.id, delay.String(), truncate(sendErr.Error(), 1000))
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func retryDelay(attempt int) time.Duration {
	values := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour}
	return values[int(math.Min(float64(attempt-1), float64(len(values)-1)))]
}
func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
