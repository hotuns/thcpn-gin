package config

import "testing"

func TestDefaultConfigIsValid(t *testing.T) {
	cfg := Default()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("default config should be valid: %v", err)
	}
	if cfg.ObjectStore.PublicURLPrefix != "https://iot-datas.oss-cn-beijing.aliyuncs.com" {
		t.Fatalf("expected default object store public URL prefix, got %q", cfg.ObjectStore.PublicURLPrefix)
	}
}

func TestLoadAppliesEnvironmentOverrides(t *testing.T) {
	t.Setenv("SERVER_ADDR", ":9090")
	t.Setenv("PLATFORM_DATABASE_DSN", "postgres://example:secret@127.0.0.1:5432/example?sslmode=disable")
	t.Setenv("REDIS_ADDR", "127.0.0.1:6380")
	t.Setenv("REDIS_DB", "2")
	t.Setenv("AUTH_ACCESS_TOKEN_TTL_MINUTES", "60")
	t.Setenv("AUTH_REFRESH_TOKEN_TTL_DAYS", "14")
	t.Setenv("AUTH_DEV_USER_HEADER_ENABLED", "false")
	t.Setenv("AUTH_PASSWORD_LOCK_MINUTES", "5")
	t.Setenv("SMS_PROVIDER", "noop")
	t.Setenv("SMS_TEMPLATE_PARAM_CODE_KEY", "verify_code")
	t.Setenv("ALIYUN_SMS_ENDPOINT", "dysmsapi.cn-hangzhou.aliyuncs.com")
	t.Setenv("EMAIL_PROVIDER", "noop")
	t.Setenv("EMAIL_CODE_TTL_SECONDS", "600")
	t.Setenv("EMAIL_COOLDOWN_SECONDS", "120")
	t.Setenv("EMAIL_DAILY_LIMIT", "12")
	t.Setenv("EMAIL_MAX_VERIFY_ATTEMPTS", "4")
	t.Setenv("OBJECT_STORE_PROVIDER", "file")
	t.Setenv("OBJECT_STORE_LOCAL_PATH", "/tmp/thcpn-objectstore")
	t.Setenv("OBJECT_STORE_PUBLIC_URL_PREFIX", "https://example-bucket.oss-cn-beijing.aliyuncs.com")
	t.Setenv("EXPORT_MAX_ROWS", "250000")
	t.Setenv("TRACING_ENABLED", "true")
	t.Setenv("TRACING_SERVICE_NAME", "thcpn-test")
	t.Setenv("TRACING_EXPORTER", "otlp")
	t.Setenv("TRACING_OTLP_ENDPOINT", "collector:4318")
	t.Setenv("TRACING_OTLP_INSECURE", "false")

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
	if cfg.Auth.AccessTokenTTLMinutes != 60 {
		t.Fatalf("expected auth ttl override, got %d", cfg.Auth.AccessTokenTTLMinutes)
	}
	if cfg.Auth.RefreshTokenTTLDays != 14 {
		t.Fatalf("expected auth refresh ttl override, got %d", cfg.Auth.RefreshTokenTTLDays)
	}
	if cfg.Auth.DevUserHeaderEnabled {
		t.Fatal("expected dev user header override")
	}
	if cfg.Auth.Password.LockMinutes != 5 {
		t.Fatalf("expected password lock override, got %d", cfg.Auth.Password.LockMinutes)
	}
	if cfg.SMS.Provider != "noop" {
		t.Fatalf("expected sms provider override, got %q", cfg.SMS.Provider)
	}
	if cfg.SMS.TemplateParamCodeKey != "verify_code" {
		t.Fatalf("expected sms template param override, got %q", cfg.SMS.TemplateParamCodeKey)
	}
	if cfg.SMS.Aliyun.Endpoint != "dysmsapi.cn-hangzhou.aliyuncs.com" {
		t.Fatalf("expected aliyun endpoint override, got %q", cfg.SMS.Aliyun.Endpoint)
	}
	if cfg.Email.Provider != "noop" {
		t.Fatalf("expected email provider override, got %q", cfg.Email.Provider)
	}
	if cfg.Email.CodeTTLSeconds != 600 {
		t.Fatalf("expected email code ttl override, got %d", cfg.Email.CodeTTLSeconds)
	}
	if cfg.Email.CooldownSeconds != 120 {
		t.Fatalf("expected email cooldown override, got %d", cfg.Email.CooldownSeconds)
	}
	if cfg.Email.DailyLimit != 12 {
		t.Fatalf("expected email daily limit override, got %d", cfg.Email.DailyLimit)
	}
	if cfg.Email.MaxVerifyAttempts != 4 {
		t.Fatalf("expected email max verify attempts override, got %d", cfg.Email.MaxVerifyAttempts)
	}
	if cfg.ObjectStore.Provider != "file" {
		t.Fatalf("expected object store provider override, got %q", cfg.ObjectStore.Provider)
	}
	if cfg.ObjectStore.LocalPath != "/tmp/thcpn-objectstore" {
		t.Fatalf("expected object store local path override, got %q", cfg.ObjectStore.LocalPath)
	}
	if cfg.ObjectStore.PublicURLPrefix != "https://example-bucket.oss-cn-beijing.aliyuncs.com" {
		t.Fatalf("expected object store public URL prefix override, got %q", cfg.ObjectStore.PublicURLPrefix)
	}
	if cfg.Export.MaxRows != 250000 {
		t.Fatalf("expected export max rows override, got %d", cfg.Export.MaxRows)
	}
	if !cfg.Tracing.Enabled {
		t.Fatal("expected tracing enabled override")
	}
	if cfg.Tracing.ServiceName != "thcpn-test" {
		t.Fatalf("expected tracing service name override, got %q", cfg.Tracing.ServiceName)
	}
	if cfg.Tracing.Exporter != "otlp" {
		t.Fatalf("expected tracing exporter override, got %q", cfg.Tracing.Exporter)
	}
	if cfg.Tracing.Endpoint != "collector:4318" {
		t.Fatalf("expected tracing endpoint override, got %q", cfg.Tracing.Endpoint)
	}
	if cfg.Tracing.Insecure {
		t.Fatal("expected tracing insecure override")
	}
}
