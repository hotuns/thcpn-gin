package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"thcpn-gin/internal/accessgrant"
	"thcpn-gin/internal/computedstream"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/export"
	"thcpn-gin/internal/logger"
	"thcpn-gin/internal/media"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/processing"
	"thcpn-gin/internal/task"
	"thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/tracing"
)

func main() {
	os.Exit(run())
}

func run() int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", slog.Any("error", err))
		return 1
	}

	log, platformLogs, logErr := logger.NewManaged(cfg.Logger.Level, cfg.Logger.Format, "worker", cfg.Logger)
	if logErr != nil {
		log.Warn("platform log file unavailable; using stdout", slog.Any("error", logErr))
	}
	if platformLogs != nil {
		defer platformLogs.Close()
	}
	shutdownTracing, err := tracing.Init(ctx, cfg.Tracing, log)
	if err != nil {
		log.Error("initialize tracing", slog.Any("error", err))
		return 1
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTracing(shutdownCtx); err != nil {
			log.Warn("shutdown tracing", slog.Any("error", err))
		}
	}()

	pg, err := db.NewPostgres(ctx, cfg.Database.PlatformDSN)
	if err != nil {
		log.Error("connect postgres", slog.Any("error", err))
		return 1
	}
	defer pg.Close()

	redisClient, err := db.NewRedis(ctx, cfg.Redis)
	if err != nil {
		log.Error("connect redis", slog.Any("error", err))
		return 1
	}
	defer func() {
		if err := redisClient.Close(); err != nil {
			log.Warn("close redis", slog.Any("error", err))
		}
	}()

	dataSourceService := datasource.NewService(pg)
	computedStreamService := computedstream.NewService(pg)
	telemetryService := telemetry.NewService(pg, dataSourceService, datasource.NewRuntime(nil), cfg.QueryLimits, computedStreamService)
	processor := export.NewProcessor(
		pg,
		dataSourceService,
		datasource.NewRuntime(nil),
		objectstore.NewStore(cfg.ObjectStore),
		cfg.Export,
		log,
		telemetryService,
	)
	accessGrantService := accessgrant.NewService(pg)
	processorClient := processing.NewClient(cfg.Processing.ProcessorURL)
	processingEngine := processing.NewEngine(pg, processorClient, media.NewService(pg, dataSourceService, datasource.NewRuntime(nil), objectstore.NewSigner(cfg.ObjectStore, cfg.Auth.JWTSecret), cfg.QueryLimits, objectstore.NewStore(cfg.ObjectStore)), objectstore.NewStore(cfg.ObjectStore))

	if envBool("WORKER_RUN_ONCE") {
		if err := cleanupExpiredAccess(ctx, accessGrantService, log); err != nil {
			log.Error("cleanup expired access grants", slog.Any("error", err))
			return 1
		}
		if err := cleanupExpiredExportFiles(ctx, processor, log); err != nil {
			log.Error("cleanup expired export files", slog.Any("error", err))
			return 1
		}
		processed, err := processor.ProcessAvailable(ctx, 0)
		if err != nil {
			log.Error("process export jobs", slog.Any("error", err), slog.Int("processed", processed))
			return 1
		}
		log.Info("worker run once complete", slog.Int("processed", processed))
		return 0
	}

	concurrency := envInt("WORKER_CONCURRENCY", 5)
	server, mux := task.NewExportServer(redisClient, processor, log, concurrency, processingEngine)
	taskClient := task.NewClient(redisClient)
	defer taskClient.Close()
	startProcessingScan(ctx, taskClient, log, time.Duration(cfg.Processing.PollSeconds)*time.Second)
	startExpiredAccessCleanup(ctx, accessGrantService, log, time.Hour)
	startExpiredExportFileCleanup(ctx, processor, log, time.Hour)

	serverErr := make(chan error, 1)
	go func() {
		log.Info("worker started", slog.String("queue", task.QueueExports), slog.Int("concurrency", concurrency))
		serverErr <- server.Run(mux)
	}()

	select {
	case <-ctx.Done():
		server.Shutdown()
		log.Info("worker stopped")
		return 0
	case err := <-serverErr:
		if err != nil {
			log.Error("worker failed", slog.Any("error", err))
			return 1
		}
		return 0
	}
}

func startProcessingScan(ctx context.Context, client *task.Client, log *slog.Logger, interval time.Duration) {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	go func() {
		enqueue := func() {
			if err := client.EnqueueProcessingScan(ctx); err != nil && log != nil {
				log.Warn("enqueue processing scan", slog.Any("error", err))
			}
		}
		enqueue()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				enqueue()
			}
		}
	}()
}

func startExpiredAccessCleanup(ctx context.Context, service *accessgrant.Service, log *slog.Logger, interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	go func() {
		if err := cleanupExpiredAccess(ctx, service, log); err != nil && log != nil {
			log.Warn("cleanup expired access grants", slog.Any("error", err))
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := cleanupExpiredAccess(ctx, service, log); err != nil && log != nil {
					log.Warn("cleanup expired access grants", slog.Any("error", err))
				}
			}
		}
	}()
}

func startExpiredExportFileCleanup(ctx context.Context, processor *export.Processor, log *slog.Logger, interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	go func() {
		if err := cleanupExpiredExportFiles(ctx, processor, log); err != nil && log != nil {
			log.Warn("cleanup expired export files", slog.Any("error", err))
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := cleanupExpiredExportFiles(ctx, processor, log); err != nil && log != nil {
					log.Warn("cleanup expired export files", slog.Any("error", err))
				}
			}
		}
	}()
}

func cleanupExpiredExportFiles(ctx context.Context, processor *export.Processor, log *slog.Logger) error {
	result, err := processor.CleanupExpiredFiles(ctx, 100)
	if err != nil {
		return err
	}
	if log != nil && (result.ExportJobsExpired > 0 || result.ExportFilesExpired > 0) {
		log.Info("expired export files cleaned",
			slog.Int64("jobs", result.ExportJobsExpired),
			slog.Int("files", result.ExportFilesExpired),
		)
	}
	return nil
}

func cleanupExpiredAccess(ctx context.Context, service *accessgrant.Service, log *slog.Logger) error {
	result, err := service.CleanupExpired(ctx)
	if err != nil {
		return err
	}
	if log != nil && (result.AccessGrantsExpired > 0 || result.InvitationsExpired > 0) {
		log.Info("expired access records cleaned",
			slog.Int64("access_grants", result.AccessGrantsExpired),
			slog.Int64("invitations", result.InvitationsExpired),
		)
	}
	return nil
}

func envBool(name string) bool {
	value := os.Getenv(name)
	parsed, err := strconv.ParseBool(value)
	return err == nil && parsed
}

func envInt(name string, fallback int) int {
	value := os.Getenv(name)
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
