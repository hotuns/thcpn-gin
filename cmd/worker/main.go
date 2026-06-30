package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/logger"
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

	log.Info("worker started")
	<-ctx.Done()
	log.Info("worker stopped")
	return 0
}
