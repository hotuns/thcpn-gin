package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server      ServerConfig      `yaml:"server"`
	Logger      LoggerConfig      `yaml:"logger"`
	Database    DatabaseConfig    `yaml:"database"`
	Redis       RedisConfig       `yaml:"redis"`
	ObjectStore ObjectStoreConfig `yaml:"object_store"`
	QueryLimits QueryLimitsConfig `yaml:"query_limits"`
	Export      ExportConfig      `yaml:"export"`
}

type ServerConfig struct {
	Addr string `yaml:"addr"`
}

type LoggerConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

type DatabaseConfig struct {
	PlatformDSNEnv string `yaml:"platform_dsn_env"`
	PlatformDSN    string `yaml:"platform_dsn"`
}

type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

type ObjectStoreConfig struct {
	Provider     string `yaml:"provider"`
	Endpoint     string `yaml:"endpoint"`
	Bucket       string `yaml:"bucket"`
	AccessKeyEnv string `yaml:"access_key_env"`
	SecretKeyEnv string `yaml:"secret_key_env"`
}

type QueryLimitsConfig struct {
	MaxHistoryDays   int `yaml:"max_history_days"`
	MaxPoints        int `yaml:"max_points"`
	MaxMediaPageSize int `yaml:"max_media_page_size"`
}

type ExportConfig struct {
	FileTTLHours int `yaml:"file_ttl_hours"`
}

func Default() Config {
	return Config{
		Server: ServerConfig{
			Addr: ":8080",
		},
		Logger: LoggerConfig{
			Level:  "info",
			Format: "json",
		},
		Database: DatabaseConfig{
			PlatformDSNEnv: "PLATFORM_DATABASE_DSN",
			PlatformDSN:    "postgres://thcpn:thcpn_dev_password@127.0.0.1:5432/thcpn_platform?sslmode=disable",
		},
		Redis: RedisConfig{
			Addr: "127.0.0.1:6379",
			DB:   0,
		},
		ObjectStore: ObjectStoreConfig{
			Provider:     "minio",
			Endpoint:     "127.0.0.1:9000",
			Bucket:       "iot-platform",
			AccessKeyEnv: "OBJECT_STORE_ACCESS_KEY",
			SecretKeyEnv: "OBJECT_STORE_SECRET_KEY",
		},
		QueryLimits: QueryLimitsConfig{
			MaxHistoryDays:   31,
			MaxPoints:        5000,
			MaxMediaPageSize: 100,
		},
		Export: ExportConfig{
			FileTTLHours: 72,
		},
	}
}

func Load() (Config, error) {
	cfg := Default()

	if path := strings.TrimSpace(os.Getenv("CONFIG_FILE")); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return Config{}, fmt.Errorf("read config file %q: %w", path, err)
		}
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return Config{}, fmt.Errorf("parse config file %q: %w", path, err)
		}
	}

	applyEnv(&cfg)

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func (cfg Config) Validate() error {
	if strings.TrimSpace(cfg.Server.Addr) == "" {
		return errors.New("server.addr is required")
	}
	if strings.TrimSpace(cfg.Database.PlatformDSN) == "" {
		return errors.New("database.platform_dsn is required")
	}
	if strings.TrimSpace(cfg.Redis.Addr) == "" {
		return errors.New("redis.addr is required")
	}
	if cfg.Redis.DB < 0 {
		return errors.New("redis.db must be greater than or equal to 0")
	}
	if cfg.QueryLimits.MaxHistoryDays <= 0 {
		return errors.New("query_limits.max_history_days must be greater than 0")
	}
	if cfg.QueryLimits.MaxPoints <= 0 {
		return errors.New("query_limits.max_points must be greater than 0")
	}
	if cfg.QueryLimits.MaxMediaPageSize <= 0 {
		return errors.New("query_limits.max_media_page_size must be greater than 0")
	}
	if cfg.Export.FileTTLHours <= 0 {
		return errors.New("export.file_ttl_hours must be greater than 0")
	}
	return nil
}

func applyEnv(cfg *Config) {
	if value := strings.TrimSpace(os.Getenv("SERVER_ADDR")); value != "" {
		cfg.Server.Addr = value
	}

	dsnEnv := strings.TrimSpace(cfg.Database.PlatformDSNEnv)
	if dsnEnv == "" {
		dsnEnv = "PLATFORM_DATABASE_DSN"
		cfg.Database.PlatformDSNEnv = dsnEnv
	}
	if value := strings.TrimSpace(os.Getenv(dsnEnv)); value != "" {
		cfg.Database.PlatformDSN = value
	}

	if value := strings.TrimSpace(os.Getenv("REDIS_ADDR")); value != "" {
		cfg.Redis.Addr = value
	}
	if value := os.Getenv("REDIS_PASSWORD"); value != "" {
		cfg.Redis.Password = value
	}
	if value := strings.TrimSpace(os.Getenv("REDIS_DB")); value != "" {
		if db, err := strconv.Atoi(value); err == nil {
			cfg.Redis.DB = db
		}
	}
}
