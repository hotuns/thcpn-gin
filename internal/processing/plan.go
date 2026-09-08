package processing

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/apperr"
)

type Plan struct {
	ID               uuid.UUID       `json:"id"`
	Code             string          `json:"code"`
	Name             string          `json:"name"`
	Description      string          `json:"description"`
	Status           string          `json:"status"`
	CurrentVersion   int32           `json:"current_version"`
	PublishedVersion *int32          `json:"published_version,omitempty"`
	ProcessorCode    string          `json:"processor_code"`
	ProcessorVersion string          `json:"processor_version"`
	Manifest         json.RawMessage `json:"processor_manifest"`
	Parameters       json.RawMessage `json:"parameters"`
	Trigger          json.RawMessage `json:"trigger"`
	TargetTypes      json.RawMessage `json:"target_types"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type PlanInput struct {
	Code             string
	Name             string
	Description      string
	ProcessorCode    string
	ProcessorVersion string
	Parameters       json.RawMessage
	Trigger          json.RawMessage
	TargetTypes      json.RawMessage
	ActorID          uuid.UUID
}

func (s *Service) ListPlans(ctx context.Context, publishedOnly bool) ([]Plan, error) {
	version := "p.current_version"
	where := ""
	if publishedOnly {
		version = "p.published_version"
		where = "WHERE p.status='published' AND p.published_version IS NOT NULL"
	}
	rows, err := s.db.Query(ctx, `SELECT p.id,p.code,p.name,p.description,p.status,p.current_version,p.published_version,
v.processor_code,v.processor_version,v.processor_manifest_json,v.parameters_json,v.trigger_json,v.target_types_json,p.created_at,p.updated_at
FROM processing_plans p JOIN processing_plan_versions v ON v.plan_id=p.id AND v.version=`+version+` `+where+` ORDER BY p.name`)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processing plans", err)
	}
	defer rows.Close()
	items := []Plan{}
	for rows.Next() {
		var item Plan
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Description, &item.Status, &item.CurrentVersion, &item.PublishedVersion, &item.ProcessorCode, &item.ProcessorVersion, &item.Manifest, &item.Parameters, &item.Trigger, &item.TargetTypes, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) GetPlan(ctx context.Context, id uuid.UUID, published bool) (Plan, error) {
	version := "p.current_version"
	condition := ""
	if published {
		version = "p.published_version"
		condition = " AND p.status='published' AND p.published_version IS NOT NULL"
	}
	var item Plan
	err := s.db.QueryRow(ctx, `SELECT p.id,p.code,p.name,p.description,p.status,p.current_version,p.published_version,
v.processor_code,v.processor_version,v.processor_manifest_json,v.parameters_json,v.trigger_json,v.target_types_json,p.created_at,p.updated_at
FROM processing_plans p JOIN processing_plan_versions v ON v.plan_id=p.id AND v.version=`+version+` WHERE p.id=$1`+condition, id).Scan(&item.ID, &item.Code, &item.Name, &item.Description, &item.Status, &item.CurrentVersion, &item.PublishedVersion, &item.ProcessorCode, &item.ProcessorVersion, &item.Manifest, &item.Parameters, &item.Trigger, &item.TargetTypes, &item.CreatedAt, &item.UpdatedAt)
	if err == pgx.ErrNoRows {
		return Plan{}, apperr.New(apperr.KindNotFound, "processing plan not found")
	}
	if err != nil {
		return Plan{}, apperr.Wrap(apperr.KindInternal, "get processing plan", err)
	}
	return item, nil
}

func (s *Service) CreatePlan(ctx context.Context, input PlanInput) (Plan, error) {
	input.Code = strings.TrimSpace(input.Code)
	input.Name = strings.TrimSpace(input.Name)
	if input.Code == "" || input.Name == "" {
		return Plan{}, apperr.New(apperr.KindInvalidArgument, "code and name are required")
	}
	manifest, err := s.planManifest(ctx, input)
	if err != nil {
		return Plan{}, err
	}
	normalizePlanInput(&input)
	if err := validatePlanParameters(manifest, input.Parameters); err != nil {
		return Plan{}, err
	}
	id := uuid.New()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `INSERT INTO processing_plans(id,code,name,description,created_by) VALUES($1,$2,$3,$4,$5)`, id, input.Code, input.Name, strings.TrimSpace(input.Description), input.ActorID); err != nil {
		return Plan{}, apperr.Wrap(apperr.KindConflict, "create processing plan", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO processing_plan_versions(plan_id,version,processor_code,processor_version,processor_manifest_json,parameters_json,trigger_json,target_types_json,created_by) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8)`, id, input.ProcessorCode, input.ProcessorVersion, manifest, input.Parameters, input.Trigger, input.TargetTypes, input.ActorID); err != nil {
		return Plan{}, apperr.Wrap(apperr.KindInternal, "create processing plan version", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Plan{}, err
	}
	return s.GetPlan(ctx, id, false)
}

func (s *Service) UpdatePlan(ctx context.Context, id uuid.UUID, input PlanInput) (Plan, error) {
	current, err := s.GetPlan(ctx, id, false)
	if err != nil {
		return Plan{}, err
	}
	input.Code = strings.TrimSpace(input.Code)
	input.Name = strings.TrimSpace(input.Name)
	if input.Code == "" {
		input.Code = current.Code
	}
	if input.Name == "" {
		input.Name = current.Name
	}
	manifest, err := s.planManifest(ctx, input)
	if err != nil {
		return Plan{}, err
	}
	normalizePlanInput(&input)
	if err := validatePlanParameters(manifest, input.Parameters); err != nil {
		return Plan{}, err
	}
	next := current.CurrentVersion + 1
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE processing_plans SET code=$2,name=$3,description=$4,current_version=$5,updated_at=now() WHERE id=$1`, id, input.Code, input.Name, strings.TrimSpace(input.Description), next); err != nil {
		return Plan{}, apperr.Wrap(apperr.KindConflict, "update processing plan", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO processing_plan_versions(plan_id,version,processor_code,processor_version,processor_manifest_json,parameters_json,trigger_json,target_types_json,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, next, input.ProcessorCode, input.ProcessorVersion, manifest, input.Parameters, input.Trigger, input.TargetTypes, input.ActorID); err != nil {
		return Plan{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Plan{}, err
	}
	return s.GetPlan(ctx, id, false)
}

func (s *Service) PublishPlan(ctx context.Context, id uuid.UUID) (Plan, error) {
	current, err := s.GetPlan(ctx, id, false)
	if err != nil {
		return Plan{}, err
	}
	if err := validatePlanParameters(current.Manifest, current.Parameters); err != nil {
		return Plan{}, err
	}
	command, err := s.db.Exec(ctx, `UPDATE processing_plans SET status='published',published_version=current_version,updated_at=now() WHERE id=$1`, id)
	if err != nil {
		return Plan{}, err
	}
	if command.RowsAffected() == 0 {
		return Plan{}, apperr.New(apperr.KindNotFound, "processing plan not found")
	}
	return s.GetPlan(ctx, id, false)
}
func (s *Service) DisablePlan(ctx context.Context, id uuid.UUID) (Plan, error) {
	command, err := s.db.Exec(ctx, `UPDATE processing_plans SET status='disabled',updated_at=now() WHERE id=$1`, id)
	if err != nil {
		return Plan{}, err
	}
	if command.RowsAffected() == 0 {
		return Plan{}, apperr.New(apperr.KindNotFound, "processing plan not found")
	}
	return s.GetPlan(ctx, id, false)
}

func (s *Service) planManifest(ctx context.Context, input PlanInput) (json.RawMessage, error) {
	var manifest json.RawMessage
	err := s.db.QueryRow(ctx, `SELECT manifest_json FROM processing_processors WHERE code=$1 AND version=$2 AND enabled=true`, input.ProcessorCode, input.ProcessorVersion).Scan(&manifest)
	if err == pgx.ErrNoRows {
		return nil, apperr.New(apperr.KindInvalidArgument, "processor is not available")
	}
	if err != nil {
		return nil, err
	}
	return manifest, nil
}
func normalizePlanInput(input *PlanInput) {
	if len(input.Parameters) == 0 {
		input.Parameters = json.RawMessage(`{}`)
	}
	if len(input.Trigger) == 0 {
		input.Trigger = json.RawMessage(`{"mode":"each_input"}`)
	}
	if len(input.TargetTypes) == 0 {
		input.TargetTypes = json.RawMessage(`["device"]`)
	}
}

func validatePlanParameters(manifest, parameters json.RawMessage) error {
	var contract struct {
		Parameters struct {
			Required   []string `json:"required"`
			Properties map[string]struct {
				Type string `json:"type"`
			} `json:"properties"`
			AdditionalProperties bool `json:"additionalProperties"`
		} `json:"parameters"`
	}
	if err := json.Unmarshal(manifest, &contract); err != nil {
		return apperr.New(apperr.KindInternal, "invalid processor manifest")
	}
	var values map[string]any
	if err := json.Unmarshal(parameters, &values); err != nil || values == nil {
		return apperr.New(apperr.KindInvalidArgument, "processing plan parameters must be an object")
	}
	for _, name := range contract.Parameters.Required {
		if value, ok := values[name]; !ok || value == nil {
			return apperr.New(apperr.KindInvalidArgument, "required processing parameter is missing: "+name)
		}
	}
	for name, value := range values {
		property, known := contract.Parameters.Properties[name]
		if !known {
			if !contract.Parameters.AdditionalProperties {
				return apperr.New(apperr.KindInvalidArgument, "unknown processing parameter: "+name)
			}
			continue
		}
		valid := property.Type == "" ||
			(property.Type == "string" && isString(value)) ||
			(property.Type == "number" && isNumber(value)) ||
			(property.Type == "integer" && isInteger(value)) ||
			(property.Type == "boolean" && isBoolean(value)) ||
			(property.Type == "object" && isObject(value)) ||
			(property.Type == "array" && isArray(value))
		if !valid {
			return apperr.New(apperr.KindInvalidArgument, "invalid processing parameter type: "+name)
		}
	}
	return nil
}

func isString(value any) bool { _, ok := value.(string); return ok }
func isNumber(value any) bool { _, ok := value.(float64); return ok }
func isInteger(value any) bool {
	number, ok := value.(float64)
	return ok && number == float64(int64(number))
}
func isBoolean(value any) bool { _, ok := value.(bool); return ok }
func isObject(value any) bool  { _, ok := value.(map[string]any); return ok }
func isArray(value any) bool   { _, ok := value.([]any); return ok }
