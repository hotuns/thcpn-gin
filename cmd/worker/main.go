package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/export"
	"thcpn-gin/internal/logger"
	"thcpn-gin/internal/objectstore"
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

	interval := envDurationSeconds("WORKER_POLL_INTERVAL_SECONDS", 5*time.Second)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	log.Info("worker started", slog.Duration("poll_interval", interval))
	for {
		processed, err := processor.ProcessAvailable(ctx, 10)
		if err != nil {
			log.Error("process export jobs", slog.Any("error", err), slog.Int("processed", processed))
		} else if processed > 0 {
			log.Info("processed export jobs", slog.Int("processed", processed))
		}
		select {
		case <-ctx.Done():
			log.Info("worker stopped")
			return 0
		case <-ticker.C:
		}
	}
}

func envBool(name string) bool {
	value := os.Getenv(name)
	parsed, err := strconv.ParseBool(value)
	return err == nil && parsed
}

func envDurationSeconds(name string, fallback time.Duration) time.Duration {
	value := os.Getenv(name)
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}
