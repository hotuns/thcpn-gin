package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"thcpn-gin/internal/app"
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

	router, err := app.NewRouter(app.Dependencies{
		Logger:   log,
		Postgres: pg,
		Redis:    redisClient,
		Config:   cfg,
	})
	if err != nil {
		log.Error("initialize api router", slog.Any("error", err))
		return 1
	}

	server := &http.Server{
		Addr:              cfg.Server.Addr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Info("api server started", slog.String("addr", cfg.Server.Addr))
		err := server.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Error("shutdown api server", slog.Any("error", err))
			return 1
		}
		log.Info("api server stopped")
		return 0
	case err := <-serverErr:
		if err != nil {
			log.Error("api server failed", slog.Any("error", err))
			return 1
		}
		return 0
	}
}
