package db

import (
	"context"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"

	"thcpn-gin/internal/config"
)

func TestRedisAndPostgresHealthChecks(t *testing.T) {
	if err := PingRedis(context.Background(), nil); err == nil {
		t.Fatal("expected nil redis client error")
	}
	if err := PingPostgres(context.Background(), nil); err == nil {
		t.Fatal("expected nil postgres pool error")
	}
	server := miniredis.RunT(t)
	client, err := NewRedis(context.Background(), config.RedisConfig{Addr: server.Addr()})
	if err != nil {
		t.Fatalf("connect redis: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	if err := PingRedis(context.Background(), client); err != nil {
		t.Fatalf("ping redis: %v", err)
	}
	if _, err := NewPostgres(context.Background(), "://invalid"); err == nil || !strings.Contains(err.Error(), "parse postgres dsn") {
		t.Fatalf("expected postgres DSN parse error, got %v", err)
	}
}
