package alerting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
)

const (
	TypeThreshold = "telemetry_threshold"
	TypeOffline   = "device_offline"
)

type ProfessionalGate interface {
	RequireProfessional(context.Context, uuid.UUID) error
}

type Service struct {
	db      *pgxpool.Pool
	billing ProfessionalGate
}

func NewService(db *pgxpool.Pool, billing ProfessionalGate) *Service {
	return &Service{db: db, billing: billing}
}

func (s *Service) IsOwnerOrAdmin(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error) {
	var allowed bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_members wm JOIN roles r ON r.id=wm.role_id WHERE wm.workspace_id=$1 AND wm.user_id=$2 AND wm.status='active' AND r.code IN ('owner','admin'))`, workspaceID, userID).Scan(&allowed)
	return allowed, err
}

type Rule struct {
	ID                  uuid.UUID   `json:"id"`
	WorkspaceID         uuid.UUID   `json:"workspace_id"`
	Name                string      `json:"name"`
	Type                string      `json:"type"`
	Severity            string      `json:"severity"`
	DeviceID            uuid.UUID   `json:"device_id"`
	DeviceName          string      `json:"device_name"`
	DataStreamID        *uuid.UUID  `json:"data_stream_id,omitempty"`
	DataStreamName      *string     `json:"data_stream_name,omitempty"`
	Unit                *string     `json:"unit,omitempty"`
	ConditionMode       *string     `json:"condition_mode,omitempty"`
	Lower               *float64    `json:"lower,omitempty"`
	Upper               *float64    `json:"upper,omitempty"`
	DurationSeconds     int         `json:"duration_seconds"`
	RecoveryDelta       float64     `json:"recovery_delta"`
	OfflineAfterSeconds *int        `json:"offline_after_seconds,omitempty"`
	Channels            []string    `json:"channels"`
	RecipientUserIDs    []uuid.UUID `json:"recipient_user_ids"`
	Enabled             bool        `json:"enabled"`
	EffectiveStatus     string      `json:"effective_status"`
	EvaluationState     string      `json:"evaluation_state"`
	LastEvaluatedAt     *time.Time  `json:"last_evaluated_at,omitempty"`
	LastObservedAt      *time.Time  `json:"last_observed_at,omitempty"`
	LastValue           *float64    `json:"last_value,omitempty"`
	LastError           *string     `json:"last_error,omitempty"`
	CreatedAt           time.Time   `json:"created_at"`
	UpdatedAt           time.Time   `json:"updated_at"`
}

type RuleInput struct {
	Name                string
	Type                string
	Severity            string
	DeviceID            uuid.UUID
	DataStreamID        *uuid.UUID
	ConditionMode       *string
	Lower               *float64
	Upper               *float64
	DurationSeconds     int
	RecoveryDelta       float64
	OfflineAfterSeconds *int
	Channels            []string
	RecipientUserIDs    []uuid.UUID
	Enabled             bool
}

type Event struct {
	ID                uuid.UUID  `json:"id"`
	RuleID            uuid.UUID  `json:"rule_id"`
	RuleName          string     `json:"rule_name"`
	WorkspaceID       uuid.UUID  `json:"workspace_id"`
	DeviceID          uuid.UUID  `json:"device_id"`
	DeviceName        string     `json:"device_name"`
	DataStreamID      *uuid.UUID `json:"data_stream_id,omitempty"`
	DataStreamName    *string    `json:"data_stream_name,omitempty"`
	Unit              *string    `json:"unit,omitempty"`
	Severity          string     `json:"severity"`
	Title             string     `json:"title"`
	Content           string     `json:"content"`
	TriggerValue      *float64   `json:"trigger_value,omitempty"`
	TriggerObservedAt *time.Time `json:"trigger_observed_at,omitempty"`
	TriggeredAt       time.Time  `json:"triggered_at"`
	ResolvedAt        *time.Time `json:"resolved_at,omitempty"`
	ResolvedValue     *float64   `json:"resolved_value,omitempty"`
	AcknowledgedAt    *time.Time `json:"acknowledged_at,omitempty"`
	AcknowledgedBy    *uuid.UUID `json:"acknowledged_by,omitempty"`
}

type EventFilter struct {
	Status   string
	Severity string
	DeviceID *uuid.UUID
	Limit    int
}

func (s *Service) ListRules(ctx context.Context, workspaceID uuid.UUID) ([]Rule, error) {
	professional := s.billing == nil || s.billing.RequireProfessional(ctx, workspaceID) == nil
	rows, err := s.db.Query(ctx, `SELECT r.id,r.workspace_id,r.name,r.type,r.severity,r.device_id,d.name,r.data_stream_id,ds.name,ds.unit,
		r.condition_mode,r.lower_value,r.upper_value,r.duration_seconds,r.recovery_delta,r.offline_after_seconds,r.channels,r.enabled,
		COALESCE(es.state,'normal'),es.last_evaluated_at,es.last_observed_at,es.last_value,es.last_error,r.created_at,r.updated_at,
		COALESCE(array_agg(rr.user_id) FILTER (WHERE rr.user_id IS NOT NULL),'{}'::uuid[])
	FROM alert_rules r JOIN devices d ON d.id=r.device_id LEFT JOIN data_streams ds ON ds.id=r.data_stream_id
	LEFT JOIN alert_evaluation_states es ON es.rule_id=r.id LEFT JOIN alert_rule_recipients rr ON rr.rule_id=r.id
	WHERE r.workspace_id=$1 AND r.archived_at IS NULL
	GROUP BY r.id,d.name,ds.name,ds.unit,es.state,es.last_evaluated_at,es.last_observed_at,es.last_value,es.last_error
	ORDER BY r.updated_at DESC`, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list alert rules", err)
	}
	defer rows.Close()
	items := []Rule{}
	for rows.Next() {
		var item Rule
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.Type, &item.Severity, &item.DeviceID, &item.DeviceName, &item.DataStreamID, &item.DataStreamName, &item.Unit, &item.ConditionMode, &item.Lower, &item.Upper, &item.DurationSeconds, &item.RecoveryDelta, &item.OfflineAfterSeconds, &item.Channels, &item.Enabled, &item.EvaluationState, &item.LastEvaluatedAt, &item.LastObservedAt, &item.LastValue, &item.LastError, &item.CreatedAt, &item.UpdatedAt, &item.RecipientUserIDs); err != nil {
			return nil, err
		}
		item.EffectiveStatus = "active"
		if !item.Enabled {
			item.EffectiveStatus = "disabled"
		} else if !professional {
			item.EffectiveStatus = "paused_plan"
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) CreateRule(ctx context.Context, workspaceID, actorID uuid.UUID, input RuleInput) (Rule, error) {
	if s.billing != nil {
		if err := s.billing.RequireProfessional(ctx, workspaceID); err != nil {
			return Rule{}, err
		}
	}
	if err := s.validateRule(ctx, workspaceID, &input); err != nil {
		return Rule{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Rule{}, err
	}
	defer tx.Rollback(ctx)
	var id uuid.UUID
	err = tx.QueryRow(ctx, `INSERT INTO alert_rules(workspace_id,name,type,severity,device_id,data_stream_id,condition_mode,lower_value,upper_value,duration_seconds,recovery_delta,offline_after_seconds,channels,enabled,created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, workspaceID, input.Name, input.Type, input.Severity, input.DeviceID, input.DataStreamID, input.ConditionMode, input.Lower, input.Upper, input.DurationSeconds, input.RecoveryDelta, input.OfflineAfterSeconds, input.Channels, input.Enabled, actorID).Scan(&id)
	if err != nil {
		return Rule{}, apperr.Wrap(apperr.KindInvalidArgument, "create alert rule", err)
	}
	if err := replaceRecipients(ctx, tx, id, input.RecipientUserIDs); err != nil {
		return Rule{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO alert_evaluation_states(rule_id) VALUES($1)`, id); err != nil {
		return Rule{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Rule{}, err
	}
	return s.getRule(ctx, workspaceID, id)
}

func (s *Service) UpdateRule(ctx context.Context, workspaceID, ruleID uuid.UUID, input RuleInput) (Rule, error) {
	if input.Enabled && s.billing != nil {
		if err := s.billing.RequireProfessional(ctx, workspaceID); err != nil {
			return Rule{}, err
		}
	}
	if err := s.validateRule(ctx, workspaceID, &input); err != nil {
		return Rule{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Rule{}, err
	}
	defer tx.Rollback(ctx)
	command, err := tx.Exec(ctx, `UPDATE alert_rules SET name=$3,type=$4,severity=$5,device_id=$6,data_stream_id=$7,condition_mode=$8,lower_value=$9,upper_value=$10,duration_seconds=$11,recovery_delta=$12,offline_after_seconds=$13,channels=$14,enabled=$15,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND archived_at IS NULL`, ruleID, workspaceID, input.Name, input.Type, input.Severity, input.DeviceID, input.DataStreamID, input.ConditionMode, input.Lower, input.Upper, input.DurationSeconds, input.RecoveryDelta, input.OfflineAfterSeconds, input.Channels, input.Enabled)
	if err != nil {
		return Rule{}, apperr.Wrap(apperr.KindInvalidArgument, "update alert rule", err)
	}
	if command.RowsAffected() == 0 {
		return Rule{}, apperr.New(apperr.KindNotFound, "alert rule not found")
	}
	if err = replaceRecipients(ctx, tx, ruleID, input.RecipientUserIDs); err != nil {
		return Rule{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE alert_events SET resolved_at=now() WHERE rule_id=$1 AND resolved_at IS NULL`, ruleID); err != nil {
		return Rule{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE alert_evaluation_states SET state='normal',pending_since=NULL,last_error=NULL,updated_at=now() WHERE rule_id=$1`, ruleID)
	if err != nil {
		return Rule{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Rule{}, err
	}
	return s.getRule(ctx, workspaceID, ruleID)
}

func (s *Service) ArchiveRule(ctx context.Context, workspaceID, ruleID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	command, err := tx.Exec(ctx, `UPDATE alert_rules SET archived_at=now(),enabled=false,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND archived_at IS NULL`, ruleID, workspaceID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "archive alert rule", err)
	}
	if command.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "alert rule not found")
	}
	if _, err = tx.Exec(ctx, `UPDATE alert_events SET resolved_at=now() WHERE rule_id=$1 AND resolved_at IS NULL`, ruleID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) ListEvents(ctx context.Context, workspaceID uuid.UUID, filter EventFilter) ([]Event, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	conditions := []string{"e.workspace_id=$1"}
	args := []any{workspaceID}
	add := func(sql string, v any) {
		args = append(args, v)
		conditions = append(conditions, fmt.Sprintf(sql, len(args)))
	}
	if filter.Status == "active" {
		conditions = append(conditions, "e.resolved_at IS NULL")
	} else if filter.Status == "resolved" {
		conditions = append(conditions, "e.resolved_at IS NOT NULL")
	}
	if filter.Severity != "" {
		add("e.severity=$%d", filter.Severity)
	}
	if filter.DeviceID != nil {
		add("e.device_id=$%d", *filter.DeviceID)
	}
	args = append(args, limit)
	rows, err := s.db.Query(ctx, fmt.Sprintf(`SELECT e.id,e.rule_id,r.name,e.workspace_id,e.device_id,d.name,e.data_stream_id,ds.name,ds.unit,e.severity,e.title,e.content,e.trigger_value,e.trigger_observed_at,e.triggered_at,e.resolved_at,e.resolved_value,e.acknowledged_at,e.acknowledged_by FROM alert_events e JOIN alert_rules r ON r.id=e.rule_id JOIN devices d ON d.id=e.device_id LEFT JOIN data_streams ds ON ds.id=e.data_stream_id WHERE %s ORDER BY e.triggered_at DESC LIMIT $%d`, strings.Join(conditions, " AND "), len(args)), args...)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list alert events", err)
	}
	defer rows.Close()
	items := []Event{}
	for rows.Next() {
		var item Event
		if err := rows.Scan(&item.ID, &item.RuleID, &item.RuleName, &item.WorkspaceID, &item.DeviceID, &item.DeviceName, &item.DataStreamID, &item.DataStreamName, &item.Unit, &item.Severity, &item.Title, &item.Content, &item.TriggerValue, &item.TriggerObservedAt, &item.TriggeredAt, &item.ResolvedAt, &item.ResolvedValue, &item.AcknowledgedAt, &item.AcknowledgedBy); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Acknowledge(ctx context.Context, workspaceID, eventID, userID uuid.UUID) (Event, error) {
	command, err := s.db.Exec(ctx, `UPDATE alert_events SET acknowledged_at=COALESCE(acknowledged_at,now()),acknowledged_by=COALESCE(acknowledged_by,$3) WHERE id=$1 AND workspace_id=$2`, eventID, workspaceID, userID)
	if err != nil {
		return Event{}, err
	}
	if command.RowsAffected() == 0 {
		return Event{}, apperr.New(apperr.KindNotFound, "alert event not found")
	}
	items, err := s.ListEvents(ctx, workspaceID, EventFilter{Limit: 200})
	if err != nil {
		return Event{}, err
	}
	for _, item := range items {
		if item.ID == eventID {
			return item, nil
		}
	}
	return Event{}, apperr.New(apperr.KindNotFound, "alert event not found")
}

func (s *Service) getRule(ctx context.Context, workspaceID, ruleID uuid.UUID) (Rule, error) {
	items, err := s.ListRules(ctx, workspaceID)
	if err != nil {
		return Rule{}, err
	}
	for _, item := range items {
		if item.ID == ruleID {
			return item, nil
		}
	}
	return Rule{}, apperr.New(apperr.KindNotFound, "alert rule not found")
}

func (s *Service) validateRule(ctx context.Context, workspaceID uuid.UUID, in *RuleInput) error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len([]rune(in.Name)) > 120 {
		return apperr.New(apperr.KindInvalidArgument, "alert rule name is required and must not exceed 120 characters")
	}
	if in.Type != TypeThreshold && in.Type != TypeOffline {
		return apperr.New(apperr.KindInvalidArgument, "invalid alert rule type")
	}
	if in.Severity != "warning" && in.Severity != "critical" {
		return apperr.New(apperr.KindInvalidArgument, "invalid alert severity")
	}
	if in.DurationSeconds < 0 || in.DurationSeconds > 2592000 {
		return apperr.New(apperr.KindInvalidArgument, "invalid duration_seconds")
	}
	if in.RecoveryDelta < 0 {
		return apperr.New(apperr.KindInvalidArgument, "recovery_delta must not be negative")
	}
	var assigned bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM device_assignments WHERE device_id=$1 AND workspace_id=$2 AND status='active')`, in.DeviceID, workspaceID).Scan(&assigned); err != nil {
		return err
	}
	if !assigned {
		return apperr.New(apperr.KindInvalidArgument, "device is not active in this workspace")
	}
	if in.Type == TypeThreshold {
		if in.DataStreamID == nil || in.ConditionMode == nil {
			return apperr.New(apperr.KindInvalidArgument, "threshold rules require data_stream_id and condition mode")
		}
		var valid bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM data_streams WHERE id=$1 AND device_id=$2 AND type='telemetry' AND status='active')`, *in.DataStreamID, in.DeviceID).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return apperr.New(apperr.KindInvalidArgument, "data stream is not active numeric telemetry for this device")
		}
		switch *in.ConditionMode {
		case "above":
			if in.Upper == nil || in.Lower != nil {
				return apperr.New(apperr.KindInvalidArgument, "above requires upper only")
			}
		case "below":
			if in.Lower == nil || in.Upper != nil {
				return apperr.New(apperr.KindInvalidArgument, "below requires lower only")
			}
		case "outside":
			if in.Lower == nil || in.Upper == nil || *in.Lower >= *in.Upper {
				return apperr.New(apperr.KindInvalidArgument, "outside requires lower less than upper")
			}
		default:
			return apperr.New(apperr.KindInvalidArgument, "invalid threshold mode")
		}
		in.OfflineAfterSeconds = nil
	} else {
		if in.OfflineAfterSeconds == nil || *in.OfflineAfterSeconds < 60 {
			return apperr.New(apperr.KindInvalidArgument, "offline_after_seconds must be at least 60")
		}
		in.DataStreamID = nil
		in.ConditionMode = nil
		in.Lower = nil
		in.Upper = nil
	}
	seen := map[string]bool{}
	normalized := []string{}
	for _, channel := range in.Channels {
		if channel != "in_app" && channel != "email" {
			return apperr.New(apperr.KindInvalidArgument, "invalid alert channel")
		}
		if !seen[channel] {
			seen[channel] = true
			normalized = append(normalized, channel)
		}
	}
	if len(normalized) == 0 {
		return apperr.New(apperr.KindInvalidArgument, "at least one alert channel is required")
	}
	in.Channels = normalized
	if len(in.RecipientUserIDs) == 0 {
		return apperr.New(apperr.KindInvalidArgument, "at least one recipient is required")
	}
	var count int
	if err := s.db.QueryRow(ctx, `SELECT count(DISTINCT user_id) FROM workspace_members WHERE workspace_id=$1 AND status='active' AND user_id=ANY($2::uuid[])`, workspaceID, in.RecipientUserIDs).Scan(&count); err != nil {
		return err
	}
	if count != len(uniqueUUIDs(in.RecipientUserIDs)) {
		return apperr.New(apperr.KindInvalidArgument, "all recipients must be active workspace members")
	}
	in.RecipientUserIDs = uniqueUUIDs(in.RecipientUserIDs)
	return nil
}

func replaceRecipients(ctx context.Context, tx pgx.Tx, ruleID uuid.UUID, ids []uuid.UUID) error {
	if _, err := tx.Exec(ctx, `DELETE FROM alert_rule_recipients WHERE rule_id=$1`, ruleID); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.Exec(ctx, `INSERT INTO alert_rule_recipients(rule_id,user_id) VALUES($1,$2)`, ruleID, id); err != nil {
			return err
		}
	}
	return nil
}
func uniqueUUIDs(items []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	out := []uuid.UUID{}
	for _, id := range items {
		if id != uuid.Nil && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
func snapshot(rule Rule) json.RawMessage { raw, _ := json.Marshal(rule); return raw }
func isNoRows(err error) bool            { return errors.Is(err, pgx.ErrNoRows) }
