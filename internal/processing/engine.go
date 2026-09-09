package processing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/media"
	"thcpn-gin/internal/objectstore"
)

type Engine struct {
	db     *pgxpool.Pool
	client *Client
	media  *media.Service
	store  objectstore.Store
	http   *http.Client
}

type executionCandidate struct {
	TaskID           uuid.UUID
	TaskVersion      int32
	ProcessorCode    string
	ProcessorVersion string
	Manifest         json.RawMessage
	Config           json.RawMessage
	StartAt          time.Time
}

type processorOutput struct {
	Code        string          `json:"code"`
	Kind        string          `json:"kind"`
	Value       json.RawMessage `json:"value"`
	Unit        *string         `json:"unit"`
	ObservedAt  *time.Time      `json:"observed_at"`
	URL         string          `json:"url"`
	ContentType string          `json:"content_type"`
}

func NewEngine(db *pgxpool.Pool, client *Client, mediaService *media.Service, store objectstore.Store) *Engine {
	return &Engine{db: db, client: client, media: mediaService, store: store, http: &http.Client{Timeout: 2 * time.Minute}}
}

func (e *Engine) ProcessAvailable(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := e.db.Query(ctx, `
SELECT t.id, t.current_version, v.processor_code, v.processor_version, v.processor_manifest_json, v.config_json, v.start_at
FROM processing_tasks t
JOIN processing_task_versions v ON v.task_id=t.id AND v.version=t.current_version
WHERE t.status='active' ORDER BY t.updated_at`)
	if err != nil {
		return 0, apperr.Wrap(apperr.KindInternal, "list runnable processing tasks", err)
	}
	defer rows.Close()
	candidates := []executionCandidate{}
	for rows.Next() {
		var item executionCandidate
		if err := rows.Scan(&item.TaskID, &item.TaskVersion, &item.ProcessorCode, &item.ProcessorVersion, &item.Manifest, &item.Config, &item.StartAt); err != nil {
			return 0, apperr.Wrap(apperr.KindInternal, "scan runnable processing task", err)
		}
		candidates = append(candidates, item)
	}
	processed := 0
	for _, candidate := range candidates {
		count, err := e.processTask(ctx, candidate, limit-processed)
		processed += count
		if err != nil {
			return processed, err
		}
		if processed >= limit {
			break
		}
	}
	return processed, nil
}

func (e *Engine) processTask(ctx context.Context, task executionCandidate, limit int) (int, error) {
	var contract struct {
		Category  string `json:"category"`
		Alignment struct {
			ToleranceSeconds int `json:"tolerance_seconds"`
		} `json:"alignment"`
	}
	if err := json.Unmarshal(task.Manifest, &contract); err != nil {
		return 0, apperr.Wrap(apperr.KindInternal, "decode processor execution contract", err)
	}
	if contract.Category == "timeseries" {
		return 0, nil
	}
	inputs, err := e.taskInputs(ctx, task.TaskID, task.TaskVersion)
	if err != nil || len(inputs) == 0 {
		return 0, err
	}
	for _, input := range inputs {
		if input.SourceType != "data_stream" || input.SourceID == nil {
			return 0, nil
		}
	}
	end := time.Now().UTC()
	streams := make(map[string][]media.Item, len(inputs))
	for _, input := range inputs {
		items := make([]media.Item, 0, 100)
		for page := 1; ; page++ {
			result, err := e.media.List(ctx, media.QueryInput{DataStreamID: input.SourceID, MediaType: "image", StartTime: task.StartAt, EndTime: end, Page: page, PageSize: 100, AllowUnassigned: true})
			if err != nil {
				return 0, err
			}
			items = append(items, result.Items...)
			if len(result.Items) < result.PageSize || len(items) >= result.Total {
				break
			}
		}
		sort.Slice(items, func(i, j int) bool { return items[i].CapturedAt.Before(items[j].CapturedAt) })
		streams[input.SlotCode] = items
	}
	base := streams[inputs[0].SlotCode]
	tolerance := time.Duration(contract.Alignment.ToleranceSeconds) * time.Second
	if tolerance <= 0 {
		tolerance = 2 * time.Minute
	}
	processed := 0
	for _, anchor := range base {
		if processed >= limit {
			break
		}
		selected := map[string]media.Item{inputs[0].SlotCode: anchor}
		valid := true
		for _, input := range inputs[1:] {
			item, ok := nearestMedia(streams[input.SlotCode], anchor.CapturedAt, tolerance)
			if !ok {
				valid = false
				break
			}
			selected[input.SlotCode] = item
		}
		if !valid {
			continue
		}
		keyParts := make([]string, 0, len(inputs))
		requestInputs := make([]map[string]any, 0, len(inputs))
		for _, input := range inputs {
			item := selected[input.SlotCode]
			keyParts = append(keyParts, input.SlotCode+":"+item.ID)
			requestInputs = append(requestInputs, map[string]any{"slot_code": input.SlotCode, "kind": "media", "url": item.PreviewURL, "observed_at": item.CapturedAt, "metadata": input.Config})
		}
		inputKey := strings.Join(keyParts, "|")
		executionID := uuid.New()
		command, err := e.db.Exec(ctx, `INSERT INTO processing_executions
(id, task_id, task_version, input_key, status, observed_at, queued_at)
VALUES ($1,$2,$3,$4,'queued',$5,now()) ON CONFLICT (task_id, task_version, input_key) DO NOTHING`, executionID, task.TaskID, task.TaskVersion, inputKey, anchor.CapturedAt)
		if err != nil {
			return processed, apperr.Wrap(apperr.KindInternal, "create processing execution", err)
		}
		if command.RowsAffected() == 0 {
			continue
		}
		encodedInputs, _ := json.Marshal(requestInputs)
		if err := e.runExecution(ctx, executionID, task, encodedInputs, anchor.CapturedAt); err != nil {
			_, _ = e.db.Exec(ctx, `UPDATE processing_executions SET status='failed', error_message=$2, finished_at=now(), updated_at=now() WHERE id=$1`, executionID, apperr.MessageOf(err))
			return processed, err
		}
		processed++
	}
	return processed, nil
}

func (e *Engine) runExecution(ctx context.Context, executionID uuid.UUID, task executionCandidate, inputs json.RawMessage, observedAt time.Time) error {
	state, err := e.client.Submit(ctx, ExecuteRequest{RequestID: executionID.String(), ProcessorCode: task.ProcessorCode, ProcessorVersion: task.ProcessorVersion, Inputs: inputs, Parameters: task.Config, OutputUploads: map[string]string{}})
	if err != nil {
		return err
	}
	_, err = e.db.Exec(ctx, `UPDATE processing_executions SET status='submitted', external_execution_id=$2, request_json=$3, started_at=now(), updated_at=now() WHERE id=$1`, executionID, state.ExecutionID, inputs)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "mark processing execution submitted", err)
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			state, err = e.client.Execution(ctx, state.ExecutionID)
			if err != nil {
				return err
			}
			if state.Status == "queued" || state.Status == "running" {
				continue
			}
			if state.Status == "failed" {
				return apperr.New(apperr.KindDataSource, state.Error)
			}
			if state.Status != "success" {
				return apperr.New(apperr.KindDataSource, "unknown processor execution status")
			}
			if err := e.saveOutputs(ctx, executionID, task.TaskID, observedAt, state.Outputs); err != nil {
				return err
			}
			_, err = e.db.Exec(ctx, `UPDATE processing_executions SET status='success', response_json=$2, finished_at=now(), updated_at=now() WHERE id=$1`, executionID, state.Outputs)
			return err
		}
	}
}

func (e *Engine) saveOutputs(ctx context.Context, executionID, taskID uuid.UUID, fallbackTime time.Time, raw json.RawMessage) error {
	var outputs []processorOutput
	if err := json.Unmarshal(raw, &outputs); err != nil {
		return apperr.Wrap(apperr.KindInternal, "decode processor outputs", err)
	}
	for _, output := range outputs {
		observedAt := output.ObservedAt
		if observedAt == nil {
			observedAt = &fallbackTime
		}
		var numeric *float64
		record := json.RawMessage(`{}`)
		objectKey := ""
		switch output.Kind {
		case "metric":
			var value float64
			if err := json.Unmarshal(output.Value, &value); err != nil {
				return apperr.Wrap(apperr.KindInternal, "decode metric output", err)
			}
			numeric = &value
		case "record":
			record = output.Value
		case "artifact":
			objectKey = fmt.Sprintf("processing/%s/%s/%s", taskID, executionID, output.Code)
			if strings.Contains(output.ContentType, "png") {
				objectKey += ".png"
			}
			if err := e.copyArtifact(ctx, output.URL, objectKey, output.ContentType); err != nil {
				return err
			}
		default:
			return apperr.New(apperr.KindInvalidArgument, "unsupported processor output kind")
		}
		_, err := e.db.Exec(ctx, `INSERT INTO processing_results
(id, execution_id, output_code, kind, observed_at, numeric_value, unit, record_json, object_key, content_type)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,''),NULLIF($10,''))`, uuid.New(), executionID, output.Code, output.Kind, observedAt, numeric, output.Unit, record, objectKey, output.ContentType)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "save processing output", err)
		}
	}
	return nil
}

func (e *Engine) copyArtifact(ctx context.Context, sourceURL, objectKey, contentType string) error {
	url := e.client.ResolveURL(sourceURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "create artifact request", err)
	}
	resp, err := e.http.Do(req)
	if err != nil {
		return apperr.Wrap(apperr.KindDataSource, "download processor artifact", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return apperr.New(apperr.KindDataSource, "download processor artifact failed")
	}
	if contentType == "" {
		contentType = resp.Header.Get("Content-Type")
	}
	return e.store.Put(ctx, objectstore.PutInput{ObjectKey: objectKey, ContentType: contentType, Body: io.LimitReader(resp.Body, 100<<20)})
}

func (e *Engine) taskInputs(ctx context.Context, taskID uuid.UUID, version int32) ([]TaskInput, error) {
	rows, err := e.db.Query(ctx, `SELECT slot_code, source_type, source_id, source_task_id, config_json FROM processing_task_inputs WHERE task_id=$1 AND task_version=$2 ORDER BY slot_code`, taskID, version)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list processing inputs", err)
	}
	defer rows.Close()
	result := []TaskInput{}
	for rows.Next() {
		var item TaskInput
		if err := rows.Scan(&item.SlotCode, &item.SourceType, &item.SourceID, &item.SourceTaskID, &item.Config); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func nearestMedia(items []media.Item, target time.Time, tolerance time.Duration) (media.Item, bool) {
	var best media.Item
	var bestDelta time.Duration
	for _, item := range items {
		delta := item.CapturedAt.Sub(target)
		if delta < 0 {
			delta = -delta
		}
		if delta > tolerance {
			continue
		}
		if best.ID == "" || delta < bestDelta {
			best, bestDelta = item, delta
		}
	}
	return best, best.ID != ""
}
