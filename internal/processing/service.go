package processing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/objectstore"
)

type Service struct {
	db      *pgxpool.Pool
	client  *Client
	signer  *objectstore.Signer
	store   objectstore.Store
	billing *billing.Service
}

func (s *Service) SetBilling(service *billing.Service, store objectstore.Store) {
	s.billing = service
	s.store = store
}

type Execution struct {
	ID           uuid.UUID       `json:"id"`
	TaskID       uuid.UUID       `json:"task_id"`
	TaskVersion  int32           `json:"task_version"`
	InputKey     string          `json:"input_key"`
	Status       string          `json:"status"`
	Attempt      int32           `json:"attempt"`
	ObservedAt   *time.Time      `json:"observed_at,omitempty"`
	QueuedAt     *time.Time      `json:"queued_at,omitempty"`
	StartedAt    *time.Time      `json:"started_at,omitempty"`
	FinishedAt   *time.Time      `json:"finished_at,omitempty"`
	ErrorMessage string          `json:"error_message"`
	Inputs       json.RawMessage `json:"inputs"`
	CreatedAt    time.Time       `json:"created_at"`
	Results      []Result        `json:"results"`
}

type Result struct {
	ID           uuid.UUID       `json:"id"`
	OutputCode   string          `json:"output_code"`
	Kind         string          `json:"kind"`
	ObservedAt   *time.Time      `json:"observed_at,omitempty"`
	NumericValue *float64        `json:"numeric_value,omitempty"`
	Unit         *string         `json:"unit,omitempty"`
	Record       json.RawMessage `json:"record"`
	URL          string          `json:"url,omitempty"`
	ContentType  *string         `json:"content_type,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

type ProcessorDefinition struct {
	Code        string          `json:"code"`
	Version     string          `json:"version"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Manifest    json.RawMessage `json:"manifest"`
	Enabled     bool            `json:"enabled"`
	SyncedAt    time.Time       `json:"synced_at"`
}

type TaskInput struct {
	SlotCode     string          `json:"slot_code"`
	SourceType   string          `json:"source_type"`
	SourceID     *uuid.UUID      `json:"source_id,omitempty"`
	SourceTaskID *uuid.UUID      `json:"source_task_id,omitempty"`
	Config       json.RawMessage `json:"config"`
	SourceName   string          `json:"source_name,omitempty"`
	DeviceID     *uuid.UUID      `json:"device_id,omitempty"`
	DeviceName   string          `json:"device_name,omitempty"`
}

type Task struct {
	ID                  uuid.UUID       `json:"id"`
	WorkspaceID         uuid.UUID       `json:"workspace_id"`
	Name                string          `json:"name"`
	Description         string          `json:"description"`
	TargetType          string          `json:"target_type"`
	TargetID            uuid.UUID       `json:"target_id"`
	TargetName          string          `json:"target_name"`
	Status              string          `json:"status"`
	CurrentVersion      int32           `json:"current_version"`
	ProcessorCode       string          `json:"processor_code"`
	ProcessorVersion    string          `json:"processor_version"`
	PlanID              *uuid.UUID      `json:"plan_id,omitempty"`
	PlanVersion         *int32          `json:"plan_version,omitempty"`
	PlanName            string          `json:"plan_name,omitempty"`
	PlanSnapshot        json.RawMessage `json:"plan_snapshot,omitempty"`
	Manifest            json.RawMessage `json:"processor_manifest"`
	Config              json.RawMessage `json:"config"`
	Trigger             json.RawMessage `json:"trigger"`
	StartAt             time.Time       `json:"start_at"`
	Inputs              []TaskInput     `json:"inputs"`
	Outputs             []TaskOutput    `json:"outputs"`
	CreatedAt           time.Time       `json:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at"`
	LastExecutionStatus *string         `json:"last_execution_status,omitempty"`
	LastExecutionAt     *time.Time      `json:"last_execution_at,omitempty"`
}

type TaskOutput struct {
	Code        string          `json:"code"`
	Name        string          `json:"name"`
	Kind        string          `json:"kind"`
	Unit        *string         `json:"unit,omitempty"`
	ContentType *string         `json:"content_type,omitempty"`
	Definition  json.RawMessage `json:"definition"`
}

type CreateInput struct {
	WorkspaceID      uuid.UUID
	Name             string
	Description      string
	TargetType       string
	TargetID         uuid.UUID
	ProcessorCode    string
	ProcessorVersion string
	PlanID           *uuid.UUID
	PlanVersion      *int32
	PlanSnapshot     json.RawMessage
	Config           json.RawMessage
	Trigger          json.RawMessage
	StartAt          time.Time
	Inputs           []TaskInput
	ActorID          uuid.UUID
}

func NewService(db *pgxpool.Pool, client *Client, signer *objectstore.Signer) *Service {
	return &Service{db: db, client: client, signer: signer}
}

func (s *Service) SyncCatalog(ctx context.Context) ([]ProcessorDefinition, error) {
	items, err := s.client.Catalog(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if strings.TrimSpace(item.Code) == "" || strings.TrimSpace(item.Version) == "" || strings.TrimSpace(item.Name) == "" {
			return nil, apperr.New(apperr.KindInvalidArgument, "processor manifest is missing code, version, or name")
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO processing_processors (code, version, name, description, manifest_json, synced_at, updated_at)
VALUES ($1, $2, $3, $4, $5, now(), now())
ON CONFLICT (code, version) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  manifest_json = EXCLUDED.manifest_json, synced_at = now(), updated_at = now()`,
			item.Code, item.Version, item.Name, item.Description, item.Raw)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "sync processor manifest", err)
		}
		if err := s.ensureDefaultPlan(ctx, item); err != nil {
			return nil, err
		}
	}
	return s.ListProcessors(ctx)
}

func (s *Service) ensureDefaultPlan(ctx context.Context, item ProcessorManifest) error {
	var contract struct {
		TargetTypes []string `json:"target_types"`
		Triggers    []string `json:"triggers"`
	}
	if err := json.Unmarshal(item.Raw, &contract); err != nil {
		return apperr.Wrap(apperr.KindInternal, "decode processor defaults", err)
	}
	if len(contract.TargetTypes) == 0 {
		contract.TargetTypes = []string{"device"}
	}
	mode := "each_input"
	if len(contract.Triggers) > 0 {
		mode = contract.Triggers[0]
	}
	targetTypes, _ := json.Marshal(contract.TargetTypes)
	trigger, _ := json.Marshal(map[string]string{"mode": mode})
	planID := uuid.New()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin default processing plan", err)
	}
	defer tx.Rollback(ctx)
	command, err := tx.Exec(ctx, `INSERT INTO processing_plans(id,code,name,description,status,current_version,published_version)
VALUES($1,$2,$3,$4,'published',1,1) ON CONFLICT(code) DO NOTHING`, planID, item.Code, item.Name, item.Description)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "create default processing plan", err)
	}
	if command.RowsAffected() == 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `INSERT INTO processing_plan_versions(plan_id,version,processor_code,processor_version,processor_manifest_json,parameters_json,trigger_json,target_types_json)
VALUES($1,1,$2,$3,$4,'{}'::jsonb,$5,$6)`, planID, item.Code, item.Version, item.Raw, trigger, targetTypes)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "create default processing plan version", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit default processing plan", err)
	}
	return nil
}

func (s *Service) ListProcessors(ctx context.Context) ([]ProcessorDefinition, error) {
	rows, err := s.db.Query(ctx, `SELECT code, version, name, description, manifest_json, enabled, synced_at
FROM processing_processors ORDER BY name, version DESC`)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processors", err)
	}
	defer rows.Close()
	result := []ProcessorDefinition{}
	for rows.Next() {
		var item ProcessorDefinition
		if err := rows.Scan(&item.Code, &item.Version, &item.Name, &item.Description, &item.Manifest, &item.Enabled, &item.SyncedAt); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan processor", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) ListTasks(ctx context.Context, workspaceID uuid.UUID) ([]Task, error) {
	rows, err := s.db.Query(ctx, `
SELECT t.id, t.workspace_id, t.name, t.description, t.target_type, t.target_id, t.status, t.current_version,
       v.processor_code, v.processor_version, v.plan_id, v.plan_version, COALESCE(p.name,''), v.plan_snapshot_json, v.processor_manifest_json, v.config_json, v.trigger_json, v.start_at,
       t.created_at, t.updated_at,
       (SELECT e.status FROM processing_executions e WHERE e.task_id=t.id ORDER BY e.created_at DESC LIMIT 1),
       (SELECT e.created_at FROM processing_executions e WHERE e.task_id=t.id ORDER BY e.created_at DESC LIMIT 1),
       CASE t.target_type WHEN 'device' THEN COALESCE((SELECT d.name FROM devices d WHERE d.id=t.target_id), '')
                          WHEN 'site' THEN COALESCE((SELECT s.name FROM sites s WHERE s.id=t.target_id), '') ELSE '' END
FROM processing_tasks t
JOIN processing_task_versions v ON v.task_id = t.id AND v.version = t.current_version
LEFT JOIN processing_plans p ON p.id=v.plan_id
WHERE t.workspace_id = $1 ORDER BY t.created_at DESC`, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processing tasks", err)
	}
	defer rows.Close()
	result := []Task{}
	for rows.Next() {
		var item Task
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.Description, &item.TargetType, &item.TargetID,
			&item.Status, &item.CurrentVersion, &item.ProcessorCode, &item.ProcessorVersion, &item.PlanID, &item.PlanVersion, &item.PlanName, &item.PlanSnapshot, &item.Manifest,
			&item.Config, &item.Trigger, &item.StartAt, &item.CreatedAt, &item.UpdatedAt, &item.LastExecutionStatus, &item.LastExecutionAt, &item.TargetName); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan processing task", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) GetTask(ctx context.Context, workspaceID, taskID uuid.UUID) (Task, error) {
	var item Task
	err := s.db.QueryRow(ctx, `
SELECT t.id, t.workspace_id, t.name, t.description, t.target_type, t.target_id, t.status, t.current_version,
       v.processor_code, v.processor_version, v.plan_id, v.plan_version, COALESCE(p.name,''), v.plan_snapshot_json, v.processor_manifest_json, v.config_json, v.trigger_json, v.start_at,
       t.created_at, t.updated_at,
       (SELECT e.status FROM processing_executions e WHERE e.task_id=t.id ORDER BY e.created_at DESC LIMIT 1),
       (SELECT e.created_at FROM processing_executions e WHERE e.task_id=t.id ORDER BY e.created_at DESC LIMIT 1),
       CASE t.target_type WHEN 'device' THEN COALESCE((SELECT d.name FROM devices d WHERE d.id=t.target_id), '')
                          WHEN 'site' THEN COALESCE((SELECT s.name FROM sites s WHERE s.id=t.target_id), '') ELSE '' END
FROM processing_tasks t
JOIN processing_task_versions v ON v.task_id = t.id AND v.version = t.current_version
LEFT JOIN processing_plans p ON p.id=v.plan_id
WHERE t.workspace_id = $1 AND t.id = $2`, workspaceID, taskID).Scan(
		&item.ID, &item.WorkspaceID, &item.Name, &item.Description, &item.TargetType, &item.TargetID,
		&item.Status, &item.CurrentVersion, &item.ProcessorCode, &item.ProcessorVersion, &item.PlanID, &item.PlanVersion, &item.PlanName, &item.PlanSnapshot, &item.Manifest,
		&item.Config, &item.Trigger, &item.StartAt, &item.CreatedAt, &item.UpdatedAt, &item.LastExecutionStatus, &item.LastExecutionAt, &item.TargetName)
	if err != nil {
		if err == pgx.ErrNoRows {
			return Task{}, apperr.New(apperr.KindNotFound, "processing task not found")
		}
		return Task{}, apperr.Wrap(apperr.KindInternal, "get processing task", err)
	}
	inputs, err := s.listInputs(ctx, taskID, item.CurrentVersion)
	if err != nil {
		return Task{}, err
	}
	item.Inputs = inputs
	outputs, err := s.listOutputs(ctx, taskID, item.CurrentVersion)
	if err != nil {
		return Task{}, err
	}
	item.Outputs = outputs
	return item, nil
}

func (s *Service) ListExecutions(ctx context.Context, workspaceID, taskID uuid.UUID) ([]Execution, error) {
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM processing_tasks WHERE id=$1 AND workspace_id=$2)`, taskID, workspaceID).Scan(&exists); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "validate processing task", err)
	}
	if !exists {
		return nil, apperr.New(apperr.KindNotFound, "processing task not found")
	}
	rows, err := s.db.Query(ctx, `SELECT id, task_id, task_version, input_key, status, attempt, observed_at,
queued_at, started_at, finished_at, error_message, request_json, created_at
FROM processing_executions WHERE task_id=$1 ORDER BY created_at DESC LIMIT 100`, taskID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processing executions", err)
	}
	defer rows.Close()
	items := []Execution{}
	for rows.Next() {
		var item Execution
		if err := rows.Scan(&item.ID, &item.TaskID, &item.TaskVersion, &item.InputKey, &item.Status, &item.Attempt,
			&item.ObservedAt, &item.QueuedAt, &item.StartedAt, &item.FinishedAt, &item.ErrorMessage, &item.Inputs, &item.CreatedAt); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan processing execution", err)
		}
		item.Results, err = s.listResults(ctx, workspaceID, item.ID)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) listResults(ctx context.Context, workspaceID, executionID uuid.UUID) ([]Result, error) {
	rows, err := s.db.Query(ctx, `SELECT id, output_code, kind, observed_at, numeric_value, unit,
record_json, COALESCE(object_key, ''), content_type, created_at
FROM processing_results WHERE execution_id=$1 ORDER BY created_at`, executionID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processing results", err)
	}
	defer rows.Close()
	items := []Result{}
	for rows.Next() {
		var item Result
		var objectKey string
		if err := rows.Scan(&item.ID, &item.OutputCode, &item.Kind, &item.ObservedAt, &item.NumericValue,
			&item.Unit, &item.Record, &objectKey, &item.ContentType, &item.CreatedAt); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan processing result", err)
		}
		if objectKey != "" {
			item.URL = "/api/v1/workspaces/" + workspaceID.String() + "/processing-results/" + item.ID.String() + "/download"
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) PrepareResultDownload(ctx context.Context, workspaceID, resultID, actorID uuid.UUID) (string, time.Time, error) {
	if s.signer == nil || s.store == nil || s.billing == nil {
		return "", time.Time{}, apperr.New(apperr.KindInternal, "processing download is not configured")
	}
	var objectKey string
	err := s.db.QueryRow(ctx, `SELECT r.object_key FROM processing_results r JOIN processing_executions e ON e.id=r.execution_id JOIN processing_tasks t ON t.id=e.task_id WHERE r.id=$1 AND t.workspace_id=$2 AND r.object_key IS NOT NULL`, resultID, workspaceID).Scan(&objectKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, apperr.New(apperr.KindNotFound, "processing result not found")
	}
	if err != nil {
		return "", time.Time{}, apperr.Wrap(apperr.KindInternal, "load processing result", err)
	}
	if err = s.billing.RequireProfessional(ctx, workspaceID); err != nil {
		return "", time.Time{}, err
	}
	info, err := objectstore.Stat(ctx, s.store, objectKey)
	if err != nil {
		return "", time.Time{}, err
	}
	if info.SizeBytes <= 0 {
		return "", time.Time{}, apperr.New(apperr.KindConflict, "processing artifact size is unavailable")
	}
	if err = s.billing.ReserveDownload(ctx, billing.ReserveDownloadInput{WorkspaceID: workspaceID, SourceType: "processing", ResourceID: &resultID, ObjectKey: objectKey, Bytes: info.SizeBytes, ActorUserID: &actorID, IdempotencyKey: "processing:" + resultID.String() + ":" + uuid.NewString()}); err != nil {
		return "", time.Time{}, err
	}
	signed, err := s.signer.SignObjectURL(objectKey, 15*time.Minute)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed.URL, signed.ExpiresAt, nil
}

func (s *Service) CreateTask(ctx context.Context, input CreateInput) (Task, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || input.TargetID == uuid.Nil || input.WorkspaceID == uuid.Nil {
		return Task{}, apperr.New(apperr.KindInvalidArgument, "name, workspace_id and target_id are required")
	}
	if input.TargetType != "device" && input.TargetType != "site" {
		return Task{}, apperr.New(apperr.KindInvalidArgument, "target_type must be device or site")
	}
	if input.StartAt.IsZero() {
		input.StartAt = time.Now().UTC()
	}
	if len(input.Config) == 0 {
		input.Config = json.RawMessage(`{}`)
	}
	if len(input.Trigger) == 0 {
		input.Trigger = json.RawMessage(`{"mode":"each_input"}`)
	}
	var manifest json.RawMessage
	err := s.db.QueryRow(ctx, `SELECT manifest_json FROM processing_processors
WHERE code = $1 AND version = $2 AND enabled = true`, input.ProcessorCode, input.ProcessorVersion).Scan(&manifest)
	if err != nil {
		if err == pgx.ErrNoRows {
			return Task{}, apperr.New(apperr.KindInvalidArgument, "processor is not available")
		}
		return Task{}, apperr.Wrap(apperr.KindInternal, "load processor", err)
	}
	var contract struct {
		RequiredCapability string `json:"required_capability"`
	}
	if err := json.Unmarshal(manifest, &contract); err != nil {
		return Task{}, apperr.Wrap(apperr.KindInternal, "decode processor manifest", err)
	}
	if err := s.validateInputCapabilities(ctx, input.WorkspaceID, input.Inputs, contract.RequiredCapability); err != nil {
		return Task{}, err
	}
	if err := s.rejectDuplicateTask(ctx, input); err != nil {
		return Task{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, apperr.Wrap(apperr.KindInternal, "begin processing task", err)
	}
	defer tx.Rollback(ctx)
	taskID := uuid.New()
	_, err = tx.Exec(ctx, `INSERT INTO processing_tasks
(id, workspace_id, name, description, target_type, target_id, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7)`, taskID, input.WorkspaceID, input.Name, strings.TrimSpace(input.Description), input.TargetType, input.TargetID, input.ActorID)
	if err != nil {
		return Task{}, apperr.Wrap(apperr.KindInternal, "create processing task", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO processing_task_versions
(task_id, version, processor_code, processor_version, plan_id, plan_version, plan_snapshot_json, processor_manifest_json, config_json, trigger_json, start_at, created_by)
VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, taskID, input.ProcessorCode, input.ProcessorVersion, input.PlanID, input.PlanVersion, input.PlanSnapshot, manifest, input.Config, input.Trigger, input.StartAt, input.ActorID)
	if err != nil {
		return Task{}, apperr.Wrap(apperr.KindInternal, "create processing task version", err)
	}
	var outputContract struct {
		Outputs []json.RawMessage `json:"outputs"`
	}
	if err := json.Unmarshal(manifest, &outputContract); err != nil {
		return Task{}, apperr.Wrap(apperr.KindInternal, "decode processor outputs", err)
	}
	for _, raw := range outputContract.Outputs {
		var output struct{ Code, Name, Kind, Unit, ContentType string }
		if err := json.Unmarshal(raw, &output); err != nil {
			return Task{}, apperr.Wrap(apperr.KindInternal, "decode processor output", err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO processing_task_outputs
(task_id, task_version, output_code, name, kind, unit, content_type, definition_json)
VALUES ($1,1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7)`, taskID, output.Code, output.Name, output.Kind, output.Unit, output.ContentType, raw)
		if err != nil {
			return Task{}, apperr.Wrap(apperr.KindInternal, "create derived output", err)
		}
	}
	for _, item := range input.Inputs {
		if len(item.Config) == 0 {
			item.Config = json.RawMessage(`{}`)
		}
		_, err = tx.Exec(ctx, `INSERT INTO processing_task_inputs
(task_id, task_version, slot_code, source_type, source_id, source_task_id, config_json)
VALUES ($1,1,$2,$3,$4,$5,$6)`, taskID, item.SlotCode, item.SourceType, item.SourceID, item.SourceTaskID, item.Config)
		if err != nil {
			return Task{}, apperr.Wrap(apperr.KindInvalidArgument, "create processing task input", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, apperr.Wrap(apperr.KindInternal, "commit processing task", err)
	}
	return s.GetTask(ctx, input.WorkspaceID, taskID)
}

func (s *Service) validateInputCapabilities(ctx context.Context, workspaceID uuid.UUID, inputs []TaskInput, required string) error {
	for _, input := range inputs {
		if input.SourceType != "data_stream" || input.SourceID == nil {
			continue
		}
		var allowed bool
		err := s.db.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM data_streams ds
  JOIN device_assignments da ON da.device_id=ds.device_id AND da.status='active'
  WHERE ds.id=$1 AND da.workspace_id=$2
    AND ($3='' OR EXISTS (SELECT 1 FROM device_capabilities dc WHERE dc.device_id=ds.device_id AND dc.capability_code=$3))
)`, input.SourceID, workspaceID, required).Scan(&allowed)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "validate processing input", err)
		}
		if !allowed {
			if required != "" {
				return apperr.New(apperr.KindInvalidArgument, "input device does not support "+required)
			}
			return apperr.New(apperr.KindInvalidArgument, "input data stream is outside the workspace")
		}
	}
	return nil
}

func (s *Service) SetStatus(ctx context.Context, workspaceID, taskID uuid.UUID, status string) (Task, error) {
	if status != "active" && status != "paused" && status != "archived" {
		return Task{}, apperr.New(apperr.KindInvalidArgument, "invalid processing task status")
	}
	command, err := s.db.Exec(ctx, `UPDATE processing_tasks SET status=$3, updated_at=now()
WHERE workspace_id=$1 AND id=$2`, workspaceID, taskID, status)
	if err != nil {
		return Task{}, apperr.Wrap(apperr.KindInternal, "update processing task", err)
	}
	if command.RowsAffected() == 0 {
		return Task{}, apperr.New(apperr.KindNotFound, "processing task not found")
	}
	return s.GetTask(ctx, workspaceID, taskID)
}

func (s *Service) listInputs(ctx context.Context, taskID uuid.UUID, version int32) ([]TaskInput, error) {
	rows, err := s.db.Query(ctx, `SELECT i.slot_code, i.source_type, i.source_id, i.source_task_id, i.config_json,
       COALESCE(ds.name, upstream.name, ''), ds.device_id, COALESCE(d.name, '')
FROM processing_task_inputs i
LEFT JOIN data_streams ds ON i.source_type='data_stream' AND ds.id=i.source_id
LEFT JOIN devices d ON d.id=ds.device_id
LEFT JOIN processing_tasks upstream ON i.source_type='processing_task' AND upstream.id=i.source_task_id
WHERE i.task_id=$1 AND i.task_version=$2 ORDER BY i.slot_code`, taskID, version)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processing task inputs", err)
	}
	defer rows.Close()
	result := []TaskInput{}
	for rows.Next() {
		var item TaskInput
		if err := rows.Scan(&item.SlotCode, &item.SourceType, &item.SourceID, &item.SourceTaskID, &item.Config, &item.SourceName, &item.DeviceID, &item.DeviceName); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan processing task input", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) rejectDuplicateTask(ctx context.Context, input CreateInput) error {
	rows, err := s.db.Query(ctx, `SELECT t.id, t.current_version, v.config_json, v.trigger_json
FROM processing_tasks t
JOIN processing_task_versions v ON v.task_id=t.id AND v.version=t.current_version
WHERE t.workspace_id=$1 AND t.status<>'archived' AND t.target_type=$2 AND t.target_id=$3
  AND v.processor_code=$4 AND v.processor_version=$5`, input.WorkspaceID, input.TargetType, input.TargetID, input.ProcessorCode, input.ProcessorVersion)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "check duplicate processing task", err)
	}
	defer rows.Close()
	for rows.Next() {
		var taskID uuid.UUID
		var version int32
		var config, trigger json.RawMessage
		if err := rows.Scan(&taskID, &version, &config, &trigger); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan duplicate processing task", err)
		}
		existingInputs, err := s.listInputs(ctx, taskID, version)
		if err != nil {
			return err
		}
		if jsonEqual(config, input.Config) && jsonEqual(trigger, input.Trigger) && processingInputsEqual(existingInputs, input.Inputs) {
			return apperr.New(apperr.KindConflict, "相同配置的处理任务已存在")
		}
	}
	return rows.Err()
}

func processingInputsEqual(left, right []TaskInput) bool {
	if len(left) != len(right) {
		return false
	}
	leftCopy := append([]TaskInput(nil), left...)
	rightCopy := append([]TaskInput(nil), right...)
	sort.Slice(leftCopy, func(i, j int) bool { return leftCopy[i].SlotCode < leftCopy[j].SlotCode })
	sort.Slice(rightCopy, func(i, j int) bool { return rightCopy[i].SlotCode < rightCopy[j].SlotCode })
	for index := range leftCopy {
		a, b := leftCopy[index], rightCopy[index]
		if a.SlotCode != b.SlotCode || a.SourceType != b.SourceType || !uuidPtrEqual(a.SourceID, b.SourceID) || !uuidPtrEqual(a.SourceTaskID, b.SourceTaskID) || !jsonEqual(a.Config, b.Config) {
			return false
		}
	}
	return true
}

func uuidPtrEqual(left, right *uuid.UUID) bool {
	return left == nil && right == nil || left != nil && right != nil && *left == *right
}

func jsonEqual(left, right json.RawMessage) bool {
	var a, b any
	if json.Unmarshal(left, &a) != nil || json.Unmarshal(right, &b) != nil {
		return bytes.Equal(bytes.TrimSpace(left), bytes.TrimSpace(right))
	}
	return reflect.DeepEqual(a, b)
}

func (s *Service) listOutputs(ctx context.Context, taskID uuid.UUID, version int32) ([]TaskOutput, error) {
	rows, err := s.db.Query(ctx, `SELECT output_code, name, kind, unit, content_type, definition_json FROM processing_task_outputs WHERE task_id=$1 AND task_version=$2 ORDER BY output_code`, taskID, version)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list derived outputs", err)
	}
	defer rows.Close()
	result := []TaskOutput{}
	for rows.Next() {
		var item TaskOutput
		if err := rows.Scan(&item.Code, &item.Name, &item.Kind, &item.Unit, &item.ContentType, &item.Definition); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan derived output", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
