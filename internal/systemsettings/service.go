package systemsettings

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

type Service struct {
	db             *pgxpool.Pool
	defaults       Values
	billingEnabled bool
	publicBaseURL  string
}
type Snapshot struct {
	Values               Values     `json:"values"`
	Defaults             Values     `json:"defaults,omitempty"`
	Fields               []Field    `json:"fields,omitempty"`
	Version              int64      `json:"version"`
	UpdatedAt            *time.Time `json:"updated_at,omitempty"`
	BillingEnabled       bool       `json:"billing_enabled"`
	PublicBaseURL        string     `json:"public_base_url"`
	DefaultPublicBaseURL string     `json:"default_public_base_url,omitempty"`
}
type Change struct {
	ID                  int64     `json:"id"`
	ActorName           string    `json:"actor_name"`
	Before              Values    `json:"before"`
	After               Values    `json:"after"`
	Reason              string    `json:"reason"`
	CreatedAt           time.Time `json:"created_at"`
	BeforePublicBaseURL string    `json:"before_public_base_url"`
	AfterPublicBaseURL  string    `json:"after_public_base_url"`
}
type UpdateInput struct {
	Values        Values  `json:"values"`
	Reason        string  `json:"reason"`
	PublicBaseURL *string `json:"public_base_url,omitempty"`
}
type Actor struct {
	ID                       uuid.UUID
	IP, UserAgent, RequestID string
}

func New(db *pgxpool.Pool, cfg config.Config) *Service {
	publicBaseURL, _ := config.NormalizePublicBaseURL(cfg.Deployment.PublicBaseURL)
	return &Service{db: db, defaults: defaults(cfg), billingEnabled: cfg.Billing.Enabled, publicBaseURL: publicBaseURL}
}
func clone(values Values) Values {
	result := Values{}
	for key, value := range values {
		result[key] = value
	}
	return result
}
func (s *Service) Load(ctx context.Context) (Snapshot, error) {
	result := Snapshot{Values: clone(s.defaults), Defaults: clone(s.defaults), Version: 0, BillingEnabled: s.billingEnabled, PublicBaseURL: s.publicBaseURL, DefaultPublicBaseURL: s.publicBaseURL}
	for _, field := range definitions {
		field.Default = s.defaults[field.Key]
		result.Fields = append(result.Fields, field)
	}
	if s.db == nil {
		return result, nil
	}
	var raw []byte
	var storedURL *string
	err := s.db.QueryRow(ctx, `SELECT values_json,version,updated_at,public_base_url FROM system_settings WHERE singleton=true`).Scan(&raw, &result.Version, &result.UpdatedAt, &storedURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return Snapshot{}, apperr.Wrap(apperr.KindInternal, "load system settings", err)
	}
	if storedURL != nil {
		result.PublicBaseURL = *storedURL
	}
	var stored Values
	if err = json.Unmarshal(raw, &stored); err != nil {
		return Snapshot{}, apperr.Wrap(apperr.KindInternal, "decode system settings", err)
	}
	for key, value := range stored {
		if _, ok := result.Values[key]; ok {
			result.Values[key] = value
		}
	}
	result.BillingEnabled = result.Values["billing_enabled"] == 1
	return result, nil
}
func (s *Service) Context(ctx context.Context) (context.Context, error) {
	snapshot, err := s.Load(ctx)
	if err != nil {
		return ctx, err
	}
	return With(ctx, snapshot.Values), nil
}
func Public(snapshot Snapshot) Snapshot {
	values := Values{}
	for _, field := range definitions {
		if field.Public {
			values[field.Key] = snapshot.Values[field.Key]
		}
	}
	snapshot.Values = values
	snapshot.Defaults = nil
	snapshot.Fields = nil
	snapshot.DefaultPublicBaseURL = ""
	return snapshot
}
func (s *Service) Update(ctx context.Context, input UpdateInput, actor Actor) (Snapshot, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	if len([]rune(input.Reason)) < 5 || len([]rune(input.Reason)) > 500 {
		return Snapshot{}, apperr.New(apperr.KindInvalidArgument, "修改原因须为 5–500 个字符")
	}
	if actor.ID == uuid.Nil {
		return Snapshot{}, apperr.New(apperr.KindUnauthorized, "administrator required")
	}
	if len(input.Values) == 0 && input.PublicBaseURL == nil {
		return Snapshot{}, apperr.New(apperr.KindInvalidArgument, "请至少修改一个配置项")
	}
	if input.PublicBaseURL != nil {
		normalized, err := config.NormalizePublicBaseURL(*input.PublicBaseURL)
		if err != nil {
			return Snapshot{}, apperr.New(apperr.KindInvalidArgument, err.Error())
		}
		input.PublicBaseURL = &normalized
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback(ctx)
	rawDefaults, _ := json.Marshal(s.defaults)
	if _, err = tx.Exec(ctx, `INSERT INTO system_settings(singleton,values_json) VALUES(true,$1) ON CONFLICT DO NOTHING`, rawDefaults); err != nil {
		return Snapshot{}, err
	}
	var raw []byte
	var storedURL *string
	if err = tx.QueryRow(ctx, `SELECT values_json,public_base_url FROM system_settings WHERE singleton=true FOR UPDATE`).Scan(&raw, &storedURL); err != nil {
		return Snapshot{}, err
	}
	beforeURL := s.publicBaseURL
	if storedURL != nil {
		beforeURL = *storedURL
	}
	if input.PublicBaseURL != nil {
		storedURL = input.PublicBaseURL
		if *storedURL == "" {
			storedURL = nil
		}
	}
	afterURL := s.publicBaseURL
	if storedURL != nil {
		afterURL = *storedURL
	}
	before := clone(s.defaults)
	var stored Values
	if err = json.Unmarshal(raw, &stored); err != nil {
		return Snapshot{}, err
	}
	for key, value := range stored {
		before[key] = value
	}
	after := clone(before)
	for key, value := range input.Values {
		after[key] = value
	}
	if err = Validate(after); err != nil {
		return Snapshot{}, err
	}
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if _, err = tx.Exec(ctx, `UPDATE system_settings SET values_json=$1,version=version+1,updated_at=now(),updated_by=$2,public_base_url=$3 WHERE singleton=true`, afterJSON, actor.ID, storedURL); err != nil {
		return Snapshot{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO system_settings_history(actor_admin_id,before_json,after_json,reason,before_public_base_url,after_public_base_url) VALUES($1,$2,$3,$4,$5,$6)`, actor.ID, beforeJSON, afterJSON, input.Reason, beforeURL, afterURL); err != nil {
		return Snapshot{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(actor_type,actor_admin_id,action,resource_type,result,reason,ip,user_agent,request_id) VALUES('system_admin',$1,'system.settings.update','system_settings','success',$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''))`, actor.ID, input.Reason, actor.IP, actor.UserAgent, actor.RequestID); err != nil {
		return Snapshot{}, apperr.Wrap(apperr.KindInternal, "audit system settings update", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Snapshot{}, err
	}
	return s.Load(ctx)
}
func (s *Service) History(ctx context.Context) ([]Change, error) {
	rows, err := s.db.Query(ctx, `SELECT h.id,a.name,h.before_json,h.after_json,h.reason,h.created_at,COALESCE(h.before_public_base_url,''),COALESCE(h.after_public_base_url,'') FROM system_settings_history h JOIN system_admins a ON a.id=h.actor_admin_id ORDER BY h.id DESC LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Change{}
	for rows.Next() {
		var item Change
		var before, after []byte
		if err = rows.Scan(&item.ID, &item.ActorName, &before, &after, &item.Reason, &item.CreatedAt, &item.BeforePublicBaseURL, &item.AfterPublicBaseURL); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(before, &item.Before); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(after, &item.After); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
