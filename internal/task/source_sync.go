package task

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"time"
)

const TypeSourceSync = "source:sync"

type SourceSyncProcessor interface {
	RunSourceSync(context.Context, uuid.UUID) error
}

func (c *Client) EnqueueSourceSync(ctx context.Context, id uuid.UUID) error {
	payload, _ := json.Marshal(struct {
		ID uuid.UUID `json:"id"`
	}{id})
	_, err := c.client.EnqueueContext(ctx, asynq.NewTask(TypeSourceSync, payload), asynq.Queue(QueueProcessing), asynq.TaskID("source-sync:"+id.String()), asynq.MaxRetry(2), asynq.Timeout(2*time.Hour), asynq.Retention(7*24*time.Hour))
	return err
}
func RegisterSourceSyncHandler(mux *asynq.ServeMux, processor SourceSyncProcessor) {
	mux.HandleFunc(TypeSourceSync, func(ctx context.Context, task *asynq.Task) error {
		var payload struct {
			ID uuid.UUID `json:"id"`
		}
		if json.Unmarshal(task.Payload(), &payload) != nil || payload.ID == uuid.Nil {
			return fmt.Errorf("invalid source operation: %w", asynq.SkipRetry)
		}
		return processor.RunSourceSync(ctx, payload.ID)
	})
}
