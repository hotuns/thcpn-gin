package config

import "testing"

func TestDefaultConfigIsValid(t *testing.T) {
	cfg := Default()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("default config should be valid: %v", err)
	}
}

func TestLoadAppliesEnvironmentOverrides(t *testing.T) {
	t.Setenv("SERVER_ADDR", ":9090")
	t.Setenv("PLATFORM_DATABASE_DSN", "postgres://example:secret@127.0.0.1:5432/example?sslmode=disable")
	t.Setenv("REDIS_ADDR", "127.0.0.1:6380")
	t.Setenv("REDIS_DB", "2")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Server.Addr != ":9090" {
		t.Fatalf("expected server addr override, got %q", cfg.Server.Addr)
	}
	if cfg.Database.PlatformDSN != "postgres://example:secret@127.0.0.1:5432/example?sslmode=disable" {
		t.Fatalf("expected database dsn override, got %q", cfg.Database.PlatformDSN)
	}
	if cfg.Redis.Addr != "127.0.0.1:6380" {
		t.Fatalf("expected redis addr override, got %q", cfg.Redis.Addr)
	}
	if cfg.Redis.DB != 2 {
		t.Fatalf("expected redis db override, got %d", cfg.Redis.DB)
	}
}
