package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/apperr"
)

const (
	TypeExportJob = "export:process"
	QueueExports  = "exports"
)

type ExportProcessor interface {
	ProcessJob(ctx context.Context, jobID uuid.UUID) (bool, error)
}

type ExportJobPayload struct {
	ExportJobID uuid.UUID `json:"export_job_id"`
}

type Client struct {
	client *asynq.Client
}

func NewClient(redisClient redis.UniversalClient) *Client {
	if redisClient == nil {
		return nil
	}
	return &Client{client: asynq.NewClientFromRedisClient(redisClient)}
}

func (c *Client) EnqueueExportJob(ctx context.Context, jobID uuid.UUID) error {
	if c == nil || c.client == nil {
		return apperr.New(apperr.KindInternal, "task client is not configured")
	}
	task, err := NewExportJobTask(jobID)
	if err != nil {
		return err
	}
	_, err = c.client.EnqueueContext(ctx, task, exportJobTaskOptions(jobID)...)
	if err != nil {
		if errors.Is(err, asynq.ErrDuplicateTask) || errors.Is(err, asynq.ErrTaskIDConflict) {
			return nil
		}
		return apperr.Wrap(apperr.KindInternal, "enqueue export job task", err)
	}
	return nil
}

func (c *Client) Close() error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.Close()
}

func NewExportJobTask(jobID uuid.UUID) (*asynq.Task, error) {
	if jobID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "export job id is required")
	}
	payload, err := json.Marshal(ExportJobPayload{ExportJobID: jobID})
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "marshal export job task", err)
	}
	return asynq.NewTask(TypeExportJob, payload), nil
}

func exportJobTaskOptions(jobID uuid.UUID) []asynq.Option {
	return []asynq.Option{
		asynq.Queue(QueueExports),
		asynq.TaskID(exportJobTaskID(jobID)),
		asynq.MaxRetry(0),
		asynq.Timeout(6 * time.Hour),
		asynq.Retention(7 * 24 * time.Hour),
	}
}

func exportJobTaskID(jobID uuid.UUID) string {
	return "export:" + jobID.String()
}

type ExportJobHandler struct {
	Processor ExportProcessor
	Logger    *slog.Logger
}

func (h ExportJobHandler) ProcessTask(ctx context.Context, task *asynq.Task) error {
	if task == nil {
		return fmt.Errorf("export job task is nil: %w", asynq.SkipRetry)
	}
	if task.Type() != TypeExportJob {
		return fmt.Errorf("unexpected task type %q: %w", task.Type(), asynq.SkipRetry)
	}
	if h.Processor == nil {
		return apperr.New(apperr.KindInternal, "export processor is not configured")
	}

	var payload ExportJobPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("decode export job task: %w", asynq.SkipRetry)
	}
	if payload.ExportJobID == uuid.Nil {
		return fmt.Errorf("export job id is required: %w", asynq.SkipRetry)
	}

	processed, err := h.Processor.ProcessJob(ctx, payload.ExportJobID)
	if err != nil {
		if h.Logger != nil {
			h.Logger.Warn("export task failed", slog.String("job_id", payload.ExportJobID.String()), slog.Any("error", err))
		}
		return err
	}
	if h.Logger != nil {
		h.Logger.Info("export task handled", slog.String("job_id", payload.ExportJobID.String()), slog.Bool("processed", processed))
	}
	return nil
}

func RegisterExportHandlers(mux *asynq.ServeMux, processor ExportProcessor, logger *slog.Logger) {
	mux.Handle(TypeExportJob, ExportJobHandler{Processor: processor, Logger: logger})
}

func NewExportServer(redisClient redis.UniversalClient, processor ExportProcessor, logger *slog.Logger, concurrency int) (*asynq.Server, *asynq.ServeMux) {
	if concurrency <= 0 {
		concurrency = 5
	}
	mux := asynq.NewServeMux()
	RegisterExportHandlers(mux, processor, logger)

	cfg := asynq.Config{
		Concurrency: concurrency,
		Queues: map[string]int{
			QueueExports: 10,
		},
		Logger:       SlogLogger{Logger: logger},
		ErrorHandler: exportTaskErrorHandler(logger),
	}
	return asynq.NewServerFromRedisClient(redisClient, cfg), mux
}

func exportTaskErrorHandler(logger *slog.Logger) asynq.ErrorHandler {
	return asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
		if logger == nil {
			return
		}
		jobID := ""
		var payload ExportJobPayload
		if task != nil && json.Unmarshal(task.Payload(), &payload) == nil && payload.ExportJobID != uuid.Nil {
			jobID = payload.ExportJobID.String()
		}
		logger.Warn("asynq task error", slog.String("type", taskType(task)), slog.String("job_id", jobID), slog.Any("error", err))
	})
}

func taskType(task *asynq.Task) string {
	if task == nil {
		return ""
	}
	return task.Type()
}

type SlogLogger struct {
	Logger *slog.Logger
}

func (l SlogLogger) Debug(args ...interface{}) {
	if l.Logger != nil {
		l.Logger.Debug(fmt.Sprint(args...))
	}
}

func (l SlogLogger) Info(args ...interface{}) {
	if l.Logger != nil {
		l.Logger.Info(fmt.Sprint(args...))
	}
}

func (l SlogLogger) Warn(args ...interface{}) {
	if l.Logger != nil {
		l.Logger.Warn(fmt.Sprint(args...))
	}
}

func (l SlogLogger) Error(args ...interface{}) {
	if l.Logger != nil {
		l.Logger.Error(fmt.Sprint(args...))
	}
}

func (l SlogLogger) Fatal(args ...interface{}) {
	if l.Logger != nil {
		l.Logger.Error(fmt.Sprint(args...))
	}
}
