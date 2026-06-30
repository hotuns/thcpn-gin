package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/export"
	"thcpn-gin/internal/logger"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/task"
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

	log := logger.New(cfg.Logger.Level, cfg.Logger.Format)

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

	processor := export.NewProcessor(
		pg,
		datasource.NewService(pg),
		datasource.NewRuntime(nil),
		objectstore.NewStore(cfg.ObjectStore),
		cfg.Export,
		log,
	)

	if envBool("WORKER_RUN_ONCE") {
		processed, err := processor.ProcessAvailable(ctx, 0)
		if err != nil {
			log.Error("process export jobs", slog.Any("error", err), slog.Int("processed", processed))
			return 1
		}
		log.Info("worker run once complete", slog.Int("processed", processed))
		return 0
	}

	concurrency := envInt("WORKER_CONCURRENCY", 5)
	server, mux := task.NewExportServer(redisClient, processor, log, concurrency)

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
