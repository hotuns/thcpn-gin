package task

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

type fakeExportProcessor struct {
	jobIDs []uuid.UUID
	err    error
}

func (p *fakeExportProcessor) ProcessJob(ctx context.Context, jobID uuid.UUID) (bool, error) {
	p.jobIDs = append(p.jobIDs, jobID)
	return true, p.err
}

func TestNewExportJobTask(t *testing.T) {
	jobID := uuid.New()
	task, err := NewExportJobTask(jobID)
	if err != nil {
		t.Fatalf("new task: %v", err)
	}
	if task.Type() != TypeExportJob {
		t.Fatalf("unexpected task type: %q", task.Type())
	}

	var payload ExportJobPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if payload.ExportJobID != jobID {
		t.Fatalf("unexpected job id: %s", payload.ExportJobID)
	}
}

func TestExportJobHandlerProcessesPayload(t *testing.T) {
	jobID := uuid.New()
	task, err := NewExportJobTask(jobID)
	if err != nil {
		t.Fatalf("new task: %v", err)
	}
	processor := &fakeExportProcessor{}
	handler := ExportJobHandler{Processor: processor}

	if err := handler.ProcessTask(t.Context(), task); err != nil {
		t.Fatalf("process task: %v", err)
	}
	if len(processor.jobIDs) != 1 || processor.jobIDs[0] != jobID {
		t.Fatalf("unexpected processed job ids: %v", processor.jobIDs)
	}
}

func TestExportJobHandlerRejectsInvalidPayload(t *testing.T) {
	handler := ExportJobHandler{Processor: &fakeExportProcessor{}}
	err := handler.ProcessTask(t.Context(), asynq.NewTask(TypeExportJob, []byte("{")))
	if err == nil {
		t.Fatal("expected invalid payload error")
	}
	if !errors.Is(err, asynq.SkipRetry) {
		t.Fatalf("expected SkipRetry, got %v", err)
	}
}

func TestClientEnqueuesExportJob(t *testing.T) {
	server := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: server.Addr()})
	defer redisClient.Close()

	client := NewClient(redisClient)
	jobID := uuid.New()
	if err := client.EnqueueExportJob(t.Context(), jobID); err != nil {
		t.Fatalf("enqueue export job: %v", err)
	}
	if err := client.EnqueueExportJob(t.Context(), jobID); err != nil {
		t.Fatalf("enqueue duplicate export job: %v", err)
	}

	inspector := asynq.NewInspectorFromRedisClient(redisClient)
	items, err := inspector.ListPendingTasks(QueueExports)
	if err != nil {
		t.Fatalf("list pending tasks: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one pending task, got %d", len(items))
	}
	if items[0].ID != exportJobTaskID(jobID) {
		t.Fatalf("unexpected task id: %q", items[0].ID)
	}
	if items[0].Type != TypeExportJob {
		t.Fatalf("unexpected task type: %q", items[0].Type)
	}
	if items[0].MaxRetry != 0 {
		t.Fatalf("unexpected max retry: %d", items[0].MaxRetry)
	}

	var payload ExportJobPayload
	if err := json.Unmarshal(items[0].Payload, &payload); err != nil {
		t.Fatalf("decode enqueued payload: %v", err)
	}
	if payload.ExportJobID != jobID {
		t.Fatalf("unexpected enqueued job id: %s", payload.ExportJobID)
	}
}
