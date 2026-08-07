package processing

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
)

type Service struct {
	db     *pgxpool.Pool
	client *Client
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
}

type Task struct {
	ID                  uuid.UUID       `json:"id"`
	WorkspaceID         uuid.UUID       `json:"workspace_id"`
	Name                string          `json:"name"`
	Description         string          `json:"description"`
	TargetType          string          `json:"target_type"`
	TargetID            uuid.UUID       `json:"target_id"`
	Status              string          `json:"status"`
	CurrentVersion      int32           `json:"current_version"`
	ProcessorCode       string          `json:"processor_code"`
	ProcessorVersion    string          `json:"processor_version"`
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
	Config           json.RawMessage
	Trigger          json.RawMessage
	StartAt          time.Time
	Inputs           []TaskInput
	ActorID          uuid.UUID
}

func NewService(db *pgxpool.Pool, client *Client) *Service {
	return &Service{db: db, client: client}
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
	}
	return s.ListProcessors(ctx)
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
       v.processor_code, v.processor_version, v.processor_manifest_json, v.config_json, v.trigger_json, v.start_at,
       t.created_at, t.updated_at,
       (SELECT e.status FROM processing_executions e WHERE e.task_id=t.id ORDER BY e.created_at DESC LIMIT 1),
       (SELECT e.created_at FROM processing_executions e WHERE e.task_id=t.id ORDER BY e.created_at DESC LIMIT 1)
FROM processing_tasks t
JOIN processing_task_versions v ON v.task_id = t.id AND v.version = t.current_version
WHERE t.workspace_id = $1 ORDER BY t.created_at DESC`, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processing tasks", err)
	}
	defer rows.Close()
	result := []Task{}
	for rows.Next() {
		var item Task
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.Description, &item.TargetType, &item.TargetID,
			&item.Status, &item.CurrentVersion, &item.ProcessorCode, &item.ProcessorVersion, &item.Manifest,
			&item.Config, &item.Trigger, &item.StartAt, &item.CreatedAt, &item.UpdatedAt, &item.LastExecutionStatus, &item.LastExecutionAt); err != nil {
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
       v.processor_code, v.processor_version, v.processor_manifest_json, v.config_json, v.trigger_json, v.start_at,
       t.created_at, t.updated_at,
       (SELECT e.status FROM processing_executions e WHERE e.task_id=t.id ORDER BY e.created_at DESC LIMIT 1),
       (SELECT e.created_at FROM processing_executions e WHERE e.task_id=t.id ORDER BY e.created_at DESC LIMIT 1)
FROM processing_tasks t
JOIN processing_task_versions v ON v.task_id = t.id AND v.version = t.current_version
WHERE t.workspace_id = $1 AND t.id = $2`, workspaceID, taskID).Scan(
		&item.ID, &item.WorkspaceID, &item.Name, &item.Description, &item.TargetType, &item.TargetID,
		&item.Status, &item.CurrentVersion, &item.ProcessorCode, &item.ProcessorVersion, &item.Manifest,
		&item.Config, &item.Trigger, &item.StartAt, &item.CreatedAt, &item.UpdatedAt, &item.LastExecutionStatus, &item.LastExecutionAt)
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
(task_id, version, processor_code, processor_version, processor_manifest_json, config_json, trigger_json, start_at, created_by)
VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8)`, taskID, input.ProcessorCode, input.ProcessorVersion, manifest, input.Config, input.Trigger, input.StartAt, input.ActorID)
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
	rows, err := s.db.Query(ctx, `SELECT slot_code, source_type, source_id, source_task_id, config_json
FROM processing_task_inputs WHERE task_id=$1 AND task_version=$2 ORDER BY slot_code`, taskID, version)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processing task inputs", err)
	}
	defer rows.Close()
	result := []TaskInput{}
	for rows.Next() {
		var item TaskInput
		if err := rows.Scan(&item.SlotCode, &item.SourceType, &item.SourceID, &item.SourceTaskID, &item.Config); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan processing task input", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
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
