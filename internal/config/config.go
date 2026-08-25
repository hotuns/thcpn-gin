package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Server              ServerConfig      `yaml:"server"`
	Logger              LoggerConfig      `yaml:"logger"`
	Database            DatabaseConfig    `yaml:"database"`
	Redis               RedisConfig       `yaml:"redis"`
	Auth                AuthConfig        `yaml:"auth"`
	SMS                 SMSConfig         `yaml:"sms"`
	Email               EmailConfig       `yaml:"email"`
	ObjectStore         ObjectStoreConfig `yaml:"object_store"`
	THCPNLogObjectStore ObjectStoreConfig `yaml:"thcpn_log_object_store"`
	QueryLimits         QueryLimitsConfig `yaml:"query_limits"`
	Billing             BillingConfig     `yaml:"billing"`
	Export              ExportConfig      `yaml:"export"`
	Processing          ProcessingConfig  `yaml:"processing"`
	Tracing             TracingConfig     `yaml:"tracing"`
	Ezviz               EzvizConfig       `yaml:"ezviz"`
}

type ServerConfig struct {
	Addr string `yaml:"addr"`
}

type LoggerConfig struct {
	Level          string `yaml:"level"`
	Format         string `yaml:"format"`
	Directory      string `yaml:"directory"`
	RetentionDays  int    `yaml:"retention_days"`
	MaxTotalSizeMB int64  `yaml:"max_total_size_mb"`
	MaxFileSizeMB  int64  `yaml:"max_file_size_mb"`
	SQLiteIndex    bool   `yaml:"sqlite_index"`
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

type AuthConfig struct {
	JWTSecretEnv          string         `yaml:"jwt_secret_env"`
	JWTSecret             string         `yaml:"jwt_secret"`
	AdminJWTSecretEnv     string         `yaml:"admin_jwt_secret_env"`
	AdminJWTSecret        string         `yaml:"admin_jwt_secret"`
	AccessTokenTTLMinutes int            `yaml:"access_token_ttl_minutes"`
	RefreshTokenTTLDays   int            `yaml:"refresh_token_ttl_days"`
	DevUserHeaderEnabled  bool           `yaml:"dev_user_header_enabled"`
	DevRegisterEnabled    bool           `yaml:"dev_register_enabled"`
	Password              PasswordConfig `yaml:"password"`
}

type PasswordConfig struct {
	MinLength          int `yaml:"min_length"`
	MaxLength          int `yaml:"max_length"`
	FailedAttemptLimit int `yaml:"failed_attempt_limit"`
	LockMinutes        int `yaml:"lock_minutes"`
}

type SMSConfig struct {
	Provider             string          `yaml:"provider"`
	CodeTTLSeconds       int             `yaml:"code_ttl_seconds"`
	CooldownSeconds      int             `yaml:"cooldown_seconds"`
	DailyLimit           int             `yaml:"daily_limit"`
	MaxVerifyAttempts    int             `yaml:"max_verify_attempts"`
	TemplateParamCodeKey string          `yaml:"template_param_code_key"`
	Aliyun               AliyunSMSConfig `yaml:"aliyun"`
}

type EmailConfig struct {
	Provider          string `yaml:"provider"`
	CodeTTLSeconds    int    `yaml:"code_ttl_seconds"`
	CooldownSeconds   int    `yaml:"cooldown_seconds"`
	DailyLimit        int    `yaml:"daily_limit"`
	MaxVerifyAttempts int    `yaml:"max_verify_attempts"`
}

type AliyunSMSConfig struct {
	AccessKeyIDEnv     string `yaml:"access_key_id_env"`
	AccessKeySecretEnv string `yaml:"access_key_secret_env"`
	SignNameEnv        string `yaml:"sign_name_env"`
	TemplateCodeEnv    string `yaml:"template_code_env"`
	Endpoint           string `yaml:"endpoint"`
}

type ObjectStoreConfig struct {
	Provider        string `yaml:"provider"`
	Endpoint        string `yaml:"endpoint"`
	Bucket          string `yaml:"bucket"`
	Region          string `yaml:"region"`
	LocalPath       string `yaml:"local_path"`
	PublicURLPrefix string `yaml:"public_url_prefix"`
	AccessKeyEnv    string `yaml:"access_key_env"`
	SecretKeyEnv    string `yaml:"secret_key_env"`
}

type QueryLimitsConfig struct {
	MaxHistoryDays   int `yaml:"max_history_days"`
	MaxPoints        int `yaml:"max_points"`
	MaxMediaPageSize int `yaml:"max_media_page_size"`
}

type BillingConfig struct {
	Enabled                         bool  `yaml:"enabled"`
	ProfessionalAnnualPriceCents    int64 `yaml:"professional_annual_price_cents"`
	ProfessionalDefaultMonths       int   `yaml:"professional_default_months"`
	BaseHistoryDays                 int   `yaml:"base_history_days"`
	BaseExportDays                  int   `yaml:"base_export_days"`
	MonthlyDownloadLimitGB          int64 `yaml:"monthly_download_limit_gb"`
	TrafficPackSizeGB               int64 `yaml:"traffic_pack_size_gb"`
	TrafficPackPriceCents           int64 `yaml:"traffic_pack_price_cents"`
	ExpiryNoticeDays                []int `yaml:"expiry_notice_days"`
	DownloadUsageWarningPercentages []int `yaml:"download_usage_warning_percentages"`
}

type ExportConfig struct {
	FileTTLHours int `yaml:"file_ttl_hours"`
	MaxRows      int `yaml:"max_rows"`
}

type ProcessingConfig struct {
	ProcessorURL string `yaml:"processor_url"`
	PollSeconds  int    `yaml:"poll_seconds"`
}

type TracingConfig struct {
	Enabled     bool   `yaml:"enabled"`
	ServiceName string `yaml:"service_name"`
	Exporter    string `yaml:"exporter"`
	Endpoint    string `yaml:"endpoint"`
	Insecure    bool   `yaml:"insecure"`
}

type EzvizConfig struct {
	AppKeyEnv             string `yaml:"app_key_env"`
	AppSecretEnv          string `yaml:"app_secret_env"`
	OpenAPIDomain         string `yaml:"open_api_domain"`
	AccessTokenTTLSeconds int    `yaml:"access_token_ttl_seconds"`
}

func Default() Config {
	return Config{
		Server: ServerConfig{
			Addr: ":8080",
		},
		Logger: LoggerConfig{
			Level:          "info",
			Format:         "json",
			Directory:      "var/log/thcpn",
			RetentionDays:  30,
			MaxTotalSizeMB: 5120,
			MaxFileSizeMB:  100,
			SQLiteIndex:    true,
		},
		Database: DatabaseConfig{
			PlatformDSNEnv: "PLATFORM_DATABASE_DSN",
			PlatformDSN:    "postgres://thcpn:thcpn_dev_password@127.0.0.1:5432/thcpn_platform?sslmode=disable",
		},
		Redis: RedisConfig{
			Addr: "127.0.0.1:6379",
			DB:   0,
		},
		Auth: AuthConfig{
			JWTSecretEnv:          "JWT_SECRET",
			JWTSecret:             "dev-insecure-change-me",
			AdminJWTSecretEnv:     "ADMIN_JWT_SECRET",
			AdminJWTSecret:        "dev-admin-insecure-change-me",
			AccessTokenTTLMinutes: 1440,
			RefreshTokenTTLDays:   30,
			DevUserHeaderEnabled:  true,
			DevRegisterEnabled:    true,
			Password: PasswordConfig{
				MinLength:          8,
				MaxLength:          128,
				FailedAttemptLimit: 5,
				LockMinutes:        15,
			},
		},
		SMS: SMSConfig{
			Provider:             "log",
			CodeTTLSeconds:       300,
			CooldownSeconds:      60,
			DailyLimit:           10,
			MaxVerifyAttempts:    5,
			TemplateParamCodeKey: "code",
			Aliyun: AliyunSMSConfig{
				AccessKeyIDEnv:     "ALIYUN_ACCESS_KEY_ID",
				AccessKeySecretEnv: "ALIYUN_ACCESS_KEY_SECRET",
				SignNameEnv:        "ALIYUN_SMS_SIGN_NAME",
				TemplateCodeEnv:    "ALIYUN_SMS_TEMPLATE_CODE",
				Endpoint:           "dysmsapi.aliyuncs.com",
			},
		},
		Email: EmailConfig{
			Provider:          "log",
			CodeTTLSeconds:    300,
			CooldownSeconds:   60,
			DailyLimit:        10,
			MaxVerifyAttempts: 5,
		},
		ObjectStore: ObjectStoreConfig{
			Provider:        "oss",
			Endpoint:        "https://oss-cn-beijing.aliyuncs.com",
			Bucket:          "iot-platform-datas",
			Region:          "cn-beijing",
			LocalPath:       "var/objectstore",
			PublicURLPrefix: "",
			AccessKeyEnv:    "OBJECT_STORE_ACCESS_KEY",
			SecretKeyEnv:    "OBJECT_STORE_SECRET_KEY",
		},
		THCPNLogObjectStore: ObjectStoreConfig{
			Provider:     "oss",
			Endpoint:     "",
			Bucket:       "",
			Region:       "",
			AccessKeyEnv: "THCPN_LOG_OSS_ACCESS_KEY_ID",
			SecretKeyEnv: "THCPN_LOG_OSS_ACCESS_KEY_SECRET",
		},
		QueryLimits: QueryLimitsConfig{
			MaxHistoryDays:   366,
			MaxPoints:        5000,
			MaxMediaPageSize: 100,
		},
		Billing: BillingConfig{
			Enabled:                         false,
			ProfessionalAnnualPriceCents:    200000,
			ProfessionalDefaultMonths:       12,
			BaseHistoryDays:                 90,
			BaseExportDays:                  7,
			MonthlyDownloadLimitGB:          100,
			TrafficPackSizeGB:               100,
			TrafficPackPriceCents:           10000,
			ExpiryNoticeDays:                []int{30, 7, 1},
			DownloadUsageWarningPercentages: []int{80, 95},
		},
		Export: ExportConfig{
			FileTTLHours: 72,
			MaxRows:      100000,
		},
		Processing: ProcessingConfig{
			ProcessorURL: "http://127.0.0.1:8090",
			PollSeconds:  10,
		},
		Tracing: TracingConfig{
			Enabled:     false,
			ServiceName: "thcpn-gin",
			Exporter:    "stdout",
			Endpoint:    "localhost:4318",
			Insecure:    true,
		},
		Ezviz: EzvizConfig{
			AppKeyEnv:             "EZVIZ_APP_KEY",
			AppSecretEnv:          "EZVIZ_APP_SECRET",
			OpenAPIDomain:         "https://open.ys7.com",
			AccessTokenTTLSeconds: 3600,
		},
	}
}

func Load() (Config, error) {
	if err := loadDotEnv(); err != nil {
		return Config{}, err
	}
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

// loadDotEnv makes local development independent from the process that starts
// the binary. Existing environment variables always win over values in .env.
func loadDotEnv() error {
	paths := make([]string, 0, 2)
	if path := strings.TrimSpace(os.Getenv("ENV_FILE")); path != "" {
		paths = append(paths, path)
	} else if cwd, err := os.Getwd(); err == nil {
		for dir := cwd; ; dir = filepath.Dir(dir) {
			paths = append(paths, filepath.Join(dir, ".env"))
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
		}
	}

	for _, path := range paths {
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) && os.Getenv("ENV_FILE") == "" {
				continue
			}
			return fmt.Errorf("find env file %q: %w", path, err)
		}
		values, err := godotenv.Read(path)
		if err != nil {
			return fmt.Errorf("read env file %q: %w", path, err)
		}
		for key, value := range values {
			if _, exists := os.LookupEnv(key); !exists {
				if err := os.Setenv(key, value); err != nil {
					return fmt.Errorf("set env %q from %q: %w", key, path, err)
				}
			}
		}
		return nil
	}
	return nil
}

func (cfg Config) Validate() error {
	if strings.TrimSpace(cfg.Server.Addr) == "" {
		return errors.New("server.addr is required")
	}
	if cfg.Logger.RetentionDays <= 0 || cfg.Logger.MaxTotalSizeMB <= 0 || cfg.Logger.MaxFileSizeMB <= 0 {
		return errors.New("logger retention and size limits must be greater than 0")
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
	if strings.TrimSpace(cfg.Auth.JWTSecret) == "" {
		return errors.New("auth.jwt_secret is required")
	}
	if strings.TrimSpace(cfg.Auth.AdminJWTSecret) == "" {
		return errors.New("auth.admin_jwt_secret is required")
	}
	if cfg.Auth.AccessTokenTTLMinutes <= 0 {
		return errors.New("auth.access_token_ttl_minutes must be greater than 0")
	}
	if cfg.Auth.RefreshTokenTTLDays <= 0 {
		return errors.New("auth.refresh_token_ttl_days must be greater than 0")
	}
	if cfg.Auth.Password.MinLength <= 0 {
		return errors.New("auth.password.min_length must be greater than 0")
	}
	if cfg.Auth.Password.MaxLength < cfg.Auth.Password.MinLength {
		return errors.New("auth.password.max_length must be greater than or equal to auth.password.min_length")
	}
	if cfg.Auth.Password.FailedAttemptLimit <= 0 {
		return errors.New("auth.password.failed_attempt_limit must be greater than 0")
	}
	if cfg.Auth.Password.LockMinutes <= 0 {
		return errors.New("auth.password.lock_minutes must be greater than 0")
	}
	switch strings.TrimSpace(cfg.SMS.Provider) {
	case "log", "noop", "aliyun":
	default:
		return errors.New("sms.provider must be one of log, noop, aliyun")
	}
	if cfg.SMS.CodeTTLSeconds <= 0 {
		return errors.New("sms.code_ttl_seconds must be greater than 0")
	}
	if cfg.SMS.CooldownSeconds <= 0 {
		return errors.New("sms.cooldown_seconds must be greater than 0")
	}
	if cfg.SMS.DailyLimit <= 0 {
		return errors.New("sms.daily_limit must be greater than 0")
	}
	if cfg.SMS.MaxVerifyAttempts <= 0 {
		return errors.New("sms.max_verify_attempts must be greater than 0")
	}
	if strings.TrimSpace(cfg.SMS.TemplateParamCodeKey) == "" {
		return errors.New("sms.template_param_code_key is required")
	}
	if strings.TrimSpace(cfg.SMS.Aliyun.Endpoint) == "" {
		return errors.New("sms.aliyun.endpoint is required")
	}
	switch strings.TrimSpace(cfg.Email.Provider) {
	case "log", "noop":
	default:
		return errors.New("email.provider must be one of log, noop")
	}
	if cfg.Email.CodeTTLSeconds <= 0 {
		return errors.New("email.code_ttl_seconds must be greater than 0")
	}
	if cfg.Email.CooldownSeconds <= 0 {
		return errors.New("email.cooldown_seconds must be greater than 0")
	}
	if cfg.Email.DailyLimit <= 0 {
		return errors.New("email.daily_limit must be greater than 0")
	}
	if cfg.Email.MaxVerifyAttempts <= 0 {
		return errors.New("email.max_verify_attempts must be greater than 0")
	}
	objectStoreProvider := strings.TrimSpace(cfg.ObjectStore.Provider)
	switch objectStoreProvider {
	case "file", "local", "oss", "minio", "s3":
	default:
		return errors.New("object_store.provider must be one of file, local, oss, minio, s3")
	}
	if strings.TrimSpace(cfg.ObjectStore.Bucket) == "" {
		return errors.New("object_store.bucket is required")
	}
	if objectStoreProvider != "file" && objectStoreProvider != "local" && strings.TrimSpace(cfg.ObjectStore.Endpoint) == "" {
		return errors.New("object_store.endpoint is required")
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
	if cfg.Billing.ProfessionalAnnualPriceCents < 0 || cfg.Billing.ProfessionalDefaultMonths <= 0 || cfg.Billing.BaseHistoryDays <= 0 || cfg.Billing.BaseExportDays <= 0 || cfg.Billing.MonthlyDownloadLimitGB <= 0 || cfg.Billing.TrafficPackSizeGB <= 0 || cfg.Billing.TrafficPackPriceCents < 0 {
		return errors.New("billing commercial parameters must be positive")
	}
	if len(cfg.Billing.ExpiryNoticeDays) == 0 || len(cfg.Billing.DownloadUsageWarningPercentages) == 0 {
		return errors.New("billing notice thresholds are required")
	}
	for _, days := range cfg.Billing.ExpiryNoticeDays {
		if days < 0 {
			return errors.New("billing.expiry_notice_days must not contain negative values")
		}
	}
	for _, percent := range cfg.Billing.DownloadUsageWarningPercentages {
		if percent <= 0 || percent >= 100 {
			return errors.New("billing.download_usage_warning_percentages values must be between 1 and 99")
		}
	}
	if cfg.Export.FileTTLHours <= 0 {
		return errors.New("export.file_ttl_hours must be greater than 0")
	}
	if cfg.Export.MaxRows <= 0 {
		return errors.New("export.max_rows must be greater than 0")
	}
	if strings.TrimSpace(cfg.Processing.ProcessorURL) == "" {
		return errors.New("processing.processor_url is required")
	}
	if cfg.Processing.PollSeconds <= 0 {
		return errors.New("processing.poll_seconds must be greater than 0")
	}
	if strings.TrimSpace(cfg.Tracing.ServiceName) == "" {
		return errors.New("tracing.service_name is required")
	}
	switch strings.TrimSpace(cfg.Tracing.Exporter) {
	case "stdout", "otlp", "noop":
	default:
		return errors.New("tracing.exporter must be one of stdout, otlp, noop")
	}
	if strings.TrimSpace(cfg.Ezviz.AppKeyEnv) == "" {
		return errors.New("ezviz.app_key_env is required")
	}
	if strings.TrimSpace(cfg.Ezviz.AppSecretEnv) == "" {
		return errors.New("ezviz.app_secret_env is required")
	}
	if strings.TrimSpace(cfg.Ezviz.OpenAPIDomain) == "" {
		return errors.New("ezviz.open_api_domain is required")
	}
	if cfg.Ezviz.AccessTokenTTLSeconds <= 0 {
		return errors.New("ezviz.access_token_ttl_seconds must be greater than 0")
	}
	return nil
}

func applyEnv(cfg *Config) {
	if value := strings.TrimSpace(os.Getenv("SERVER_ADDR")); value != "" {
		cfg.Server.Addr = value
	}
	if value := strings.TrimSpace(os.Getenv("LOGGER_DIRECTORY")); value != "" {
		cfg.Logger.Directory = value
	}
	if value := strings.TrimSpace(os.Getenv("LOGGER_RETENTION_DAYS")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			cfg.Logger.RetentionDays = parsed
		}
	}
	if value := strings.TrimSpace(os.Getenv("LOGGER_MAX_TOTAL_SIZE_MB")); value != "" {
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil {
			cfg.Logger.MaxTotalSizeMB = parsed
		}
	}
	if value := strings.TrimSpace(os.Getenv("LOGGER_MAX_FILE_SIZE_MB")); value != "" {
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil {
			cfg.Logger.MaxFileSizeMB = parsed
		}
	}
	if value := strings.TrimSpace(os.Getenv("LOGGER_SQLITE_INDEX")); value != "" {
		if parsed, err := strconv.ParseBool(value); err == nil {
			cfg.Logger.SQLiteIndex = parsed
		}
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

	jwtSecretEnv := strings.TrimSpace(cfg.Auth.JWTSecretEnv)
	if jwtSecretEnv == "" {
		jwtSecretEnv = "JWT_SECRET"
		cfg.Auth.JWTSecretEnv = jwtSecretEnv
	}
	if value := strings.TrimSpace(os.Getenv(jwtSecretEnv)); value != "" {
		cfg.Auth.JWTSecret = value
	}

	adminJWTSecretEnv := strings.TrimSpace(cfg.Auth.AdminJWTSecretEnv)
	if adminJWTSecretEnv == "" {
		adminJWTSecretEnv = "ADMIN_JWT_SECRET"
		cfg.Auth.AdminJWTSecretEnv = adminJWTSecretEnv
	}
	if value := strings.TrimSpace(os.Getenv(adminJWTSecretEnv)); value != "" {
		cfg.Auth.AdminJWTSecret = value
	}
	if strings.TrimSpace(cfg.Auth.AdminJWTSecret) == "" {
		cfg.Auth.AdminJWTSecret = cfg.Auth.JWTSecret + "-admin"
	}
	if value := strings.TrimSpace(os.Getenv("AUTH_ACCESS_TOKEN_TTL_MINUTES")); value != "" {
		if minutes, err := strconv.Atoi(value); err == nil {
			cfg.Auth.AccessTokenTTLMinutes = minutes
		}
	}
	if value := strings.TrimSpace(os.Getenv("AUTH_REFRESH_TOKEN_TTL_DAYS")); value != "" {
		if days, err := strconv.Atoi(value); err == nil {
			cfg.Auth.RefreshTokenTTLDays = days
		}
	}
	if value := strings.TrimSpace(os.Getenv("AUTH_DEV_USER_HEADER_ENABLED")); value != "" {
		if enabled, err := strconv.ParseBool(value); err == nil {
			cfg.Auth.DevUserHeaderEnabled = enabled
		}
	}
	if value := strings.TrimSpace(os.Getenv("AUTH_DEV_REGISTER_ENABLED")); value != "" {
		if enabled, err := strconv.ParseBool(value); err == nil {
			cfg.Auth.DevRegisterEnabled = enabled
		}
	}
	if value := strings.TrimSpace(os.Getenv("AUTH_PASSWORD_MIN_LENGTH")); value != "" {
		if length, err := strconv.Atoi(value); err == nil {
			cfg.Auth.Password.MinLength = length
		}
	}
	if value := strings.TrimSpace(os.Getenv("AUTH_PASSWORD_MAX_LENGTH")); value != "" {
		if length, err := strconv.Atoi(value); err == nil {
			cfg.Auth.Password.MaxLength = length
		}
	}
	if value := strings.TrimSpace(os.Getenv("AUTH_PASSWORD_FAILED_ATTEMPT_LIMIT")); value != "" {
		if limit, err := strconv.Atoi(value); err == nil {
			cfg.Auth.Password.FailedAttemptLimit = limit
		}
	}
	if value := strings.TrimSpace(os.Getenv("AUTH_PASSWORD_LOCK_MINUTES")); value != "" {
		if minutes, err := strconv.Atoi(value); err == nil {
			cfg.Auth.Password.LockMinutes = minutes
		}
	}
	if value := strings.TrimSpace(os.Getenv("SMS_PROVIDER")); value != "" {
		cfg.SMS.Provider = value
	}
	if value := strings.TrimSpace(os.Getenv("SMS_CODE_TTL_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil {
			cfg.SMS.CodeTTLSeconds = seconds
		}
	}
	if value := strings.TrimSpace(os.Getenv("SMS_COOLDOWN_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil {
			cfg.SMS.CooldownSeconds = seconds
		}
	}
	if value := strings.TrimSpace(os.Getenv("SMS_DAILY_LIMIT")); value != "" {
		if limit, err := strconv.Atoi(value); err == nil {
			cfg.SMS.DailyLimit = limit
		}
	}
	if value := strings.TrimSpace(os.Getenv("SMS_MAX_VERIFY_ATTEMPTS")); value != "" {
		if attempts, err := strconv.Atoi(value); err == nil {
			cfg.SMS.MaxVerifyAttempts = attempts
		}
	}
	if value := strings.TrimSpace(os.Getenv("SMS_TEMPLATE_PARAM_CODE_KEY")); value != "" {
		cfg.SMS.TemplateParamCodeKey = value
	}
	if value := strings.TrimSpace(os.Getenv("ALIYUN_SMS_ENDPOINT")); value != "" {
		cfg.SMS.Aliyun.Endpoint = value
	}
	if value := strings.TrimSpace(os.Getenv("EMAIL_PROVIDER")); value != "" {
		cfg.Email.Provider = value
	}
	if value := strings.TrimSpace(os.Getenv("EMAIL_CODE_TTL_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil {
			cfg.Email.CodeTTLSeconds = seconds
		}
	}
	if value := strings.TrimSpace(os.Getenv("EMAIL_COOLDOWN_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil {
			cfg.Email.CooldownSeconds = seconds
		}
	}
	if value := strings.TrimSpace(os.Getenv("EMAIL_DAILY_LIMIT")); value != "" {
		if limit, err := strconv.Atoi(value); err == nil {
			cfg.Email.DailyLimit = limit
		}
	}
	if value := strings.TrimSpace(os.Getenv("EMAIL_MAX_VERIFY_ATTEMPTS")); value != "" {
		if attempts, err := strconv.Atoi(value); err == nil {
			cfg.Email.MaxVerifyAttempts = attempts
		}
	}
	if value := strings.TrimSpace(os.Getenv("BILLING_ENABLED")); value != "" {
		if enabled, err := strconv.ParseBool(value); err == nil {
			cfg.Billing.Enabled = enabled
		}
	}
	if value := strings.TrimSpace(os.Getenv("OBJECT_STORE_PROVIDER")); value != "" {
		cfg.ObjectStore.Provider = value
	}
	if value := strings.TrimSpace(os.Getenv("OBJECT_STORE_ENDPOINT")); value != "" {
		cfg.ObjectStore.Endpoint = value
	}
	if value := strings.TrimSpace(os.Getenv("OBJECT_STORE_BUCKET")); value != "" {
		cfg.ObjectStore.Bucket = value
	}
	if value := strings.TrimSpace(os.Getenv("OBJECT_STORE_REGION")); value != "" {
		cfg.ObjectStore.Region = value
	}
	if value := strings.TrimSpace(os.Getenv("OBJECT_STORE_LOCAL_PATH")); value != "" {
		cfg.ObjectStore.LocalPath = value
	}
	if value := strings.TrimSpace(os.Getenv("OBJECT_STORE_PUBLIC_URL_PREFIX")); value != "" {
		cfg.ObjectStore.PublicURLPrefix = value
	}
	if value := strings.TrimSpace(os.Getenv("THCPN_LOG_OSS_PROVIDER")); value != "" {
		cfg.THCPNLogObjectStore.Provider = value
	}
	if value := strings.TrimSpace(os.Getenv("THCPN_LOG_OSS_ENDPOINT")); value != "" {
		cfg.THCPNLogObjectStore.Endpoint = value
	}
	if value := strings.TrimSpace(os.Getenv("THCPN_LOG_OSS_BUCKET")); value != "" {
		cfg.THCPNLogObjectStore.Bucket = value
	}
	if value := strings.TrimSpace(os.Getenv("THCPN_LOG_OSS_REGION")); value != "" {
		cfg.THCPNLogObjectStore.Region = value
	}
	if value := strings.TrimSpace(os.Getenv("THCPN_LOG_OSS_PUBLIC_URL_PREFIX")); value != "" {
		cfg.THCPNLogObjectStore.PublicURLPrefix = value
	}
	if strings.TrimSpace(cfg.THCPNLogObjectStore.Endpoint) == "" &&
		strings.TrimSpace(cfg.THCPNLogObjectStore.Bucket) == "" &&
		strings.TrimSpace(cfg.THCPNLogObjectStore.PublicURLPrefix) == "" {
		// Keep existing deployments working when logs live in the same OSS
		// bucket as platform media and no dedicated log store is configured.
		cfg.THCPNLogObjectStore = cfg.ObjectStore
	}
	if value := strings.TrimSpace(os.Getenv("EXPORT_FILE_TTL_HOURS")); value != "" {
		if hours, err := strconv.Atoi(value); err == nil {
			cfg.Export.FileTTLHours = hours
		}
	}
	if value := strings.TrimSpace(os.Getenv("EXPORT_MAX_ROWS")); value != "" {
		if rows, err := strconv.Atoi(value); err == nil {
			cfg.Export.MaxRows = rows
		}
	}
	if value := strings.TrimSpace(os.Getenv("PROCESSOR_URL")); value != "" {
		cfg.Processing.ProcessorURL = value
	}
	if value := strings.TrimSpace(os.Getenv("PROCESSING_POLL_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil {
			cfg.Processing.PollSeconds = seconds
		}
	}
	if value := strings.TrimSpace(os.Getenv("TRACING_ENABLED")); value != "" {
		if enabled, err := strconv.ParseBool(value); err == nil {
			cfg.Tracing.Enabled = enabled
		}
	}
	if value := strings.TrimSpace(os.Getenv("TRACING_SERVICE_NAME")); value != "" {
		cfg.Tracing.ServiceName = value
	} else if value := strings.TrimSpace(os.Getenv("OTEL_SERVICE_NAME")); value != "" {
		cfg.Tracing.ServiceName = value
	}
	if value := strings.TrimSpace(os.Getenv("TRACING_EXPORTER")); value != "" {
		cfg.Tracing.Exporter = value
	}
	if value := strings.TrimSpace(os.Getenv("TRACING_OTLP_ENDPOINT")); value != "" {
		cfg.Tracing.Endpoint = value
	} else if value := strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")); value != "" {
		cfg.Tracing.Endpoint = value
	}
	if value := strings.TrimSpace(os.Getenv("TRACING_OTLP_INSECURE")); value != "" {
		if insecure, err := strconv.ParseBool(value); err == nil {
			cfg.Tracing.Insecure = insecure
		}
	}
	if value := strings.TrimSpace(os.Getenv("EZVIZ_APP_KEY_ENV")); value != "" {
		cfg.Ezviz.AppKeyEnv = value
	}
	if value := strings.TrimSpace(os.Getenv("EZVIZ_APP_SECRET_ENV")); value != "" {
		cfg.Ezviz.AppSecretEnv = value
	}
	if value := strings.TrimSpace(os.Getenv("EZVIZ_OPEN_API_DOMAIN")); value != "" {
		cfg.Ezviz.OpenAPIDomain = value
	}
	if value := strings.TrimSpace(os.Getenv("EZVIZ_ACCESS_TOKEN_TTL_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil {
			cfg.Ezviz.AccessTokenTTLSeconds = seconds
		}
	}
}
