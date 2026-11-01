package systemsettings

import (
	"context"
	"fmt"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

type Values map[string]int

type Field struct {
	Kind    string `json:"kind,omitempty"`
	Key     string `json:"key"`
	Group   string `json:"group"`
	Label   string `json:"label"`
	Default int    `json:"default"`
	Min     int    `json:"min"`
	Max     int    `json:"max"`
	Unit    string `json:"unit"`
	Public  bool   `json:"-"`
}

var definitions = []Field{
	{Key: "billing_enabled", Group: "套餐参数", Label: "启用套餐限制", Default: 0, Min: 0, Max: 1, Unit: "开关", Public: true, Kind: "switch"},
	{Key: "query_days", Group: "查询与展示", Label: "单次数据查询跨度", Default: 366, Min: 1, Max: 36500, Unit: "天", Public: true},
	{Key: "media_days", Group: "查询与展示", Label: "单次图片查询跨度", Default: 366, Min: 1, Max: 36500, Unit: "天", Public: true},
	{Key: "dataset_query_days", Group: "查询与展示", Label: "数据集预览跨度", Default: 366, Min: 1, Max: 36500, Unit: "天", Public: true},
	{Key: "query_points", Group: "查询与展示", Label: "每次请求每指标条数", Default: 5000, Min: 2, Max: 1000000, Unit: "条", Public: true},
	{Key: "media_page_size", Group: "查询与展示", Label: "每页图片数量", Default: 100, Min: 1, Max: 1000, Unit: "张", Public: true},
	{Key: "comparison_items", Group: "查询与展示", Label: "数据比较项数", Default: 8, Min: 1, Max: 50, Unit: "项", Public: true},
	{Key: "profile_images", Group: "上传与输入", Label: "每设备安装照片数量", Default: 12, Min: 1, Max: 100, Unit: "张", Public: true},
	{Key: "image_mb", Group: "上传与输入", Label: "单张安装照片大小", Default: 10, Min: 1, Max: 100, Unit: "MB", Public: true},
	{Key: "user_name", Group: "上传与输入", Label: "姓名长度", Default: 100, Min: 1, Max: 10000, Unit: "字符", Public: true},
	{Key: "workspace_name", Group: "上传与输入", Label: "组织名称长度", Default: 120, Min: 1, Max: 10000, Unit: "字符", Public: true},
	{Key: "node_name", Group: "上传与输入", Label: "节点名称长度", Default: 50, Min: 1, Max: 10000, Unit: "字符", Public: true},
	{Key: "alert_name", Group: "上传与输入", Label: "预警名称长度", Default: 120, Min: 1, Max: 10000, Unit: "字符", Public: true},
	{Key: "api_key_name", Group: "上传与输入", Label: "API 密钥名称长度", Default: 100, Min: 1, Max: 10000, Unit: "字符", Public: true},
	{Key: "processing_name", Group: "上传与输入", Label: "数据处理任务名称长度", Default: 128, Min: 1, Max: 10000, Unit: "字符", Public: true},
	{Key: "device_description", Group: "上传与输入", Label: "用户端设备描述长度", Default: 500, Min: 1, Max: 100000, Unit: "字符", Public: true},
	{Key: "tag_count", Group: "上传与输入", Label: "每设备自定义标签数量", Default: 30, Min: 1, Max: 1000, Unit: "个", Public: true},
	{Key: "tag_length", Group: "上传与输入", Label: "单个标签长度", Default: 50, Min: 1, Max: 10000, Unit: "字符", Public: true},
	{Key: "atlas_name", Group: "一张图与预警", Label: "一张图名称长度", Default: 120, Min: 1, Max: 10000, Unit: "字符", Public: true},
	{Key: "atlas_description", Group: "一张图与预警", Label: "一张图描述长度", Default: 300, Min: 1, Max: 100000, Unit: "字符", Public: true},
	{Key: "atlas_devices", Group: "一张图与预警", Label: "一张图手选设备数量", Default: 50, Min: 1, Max: 1000, Unit: "台", Public: true},
	{Key: "atlas_trend_hours", Group: "一张图与预警", Label: "一张图趋势范围", Default: 720, Min: 1, Max: 87600, Unit: "小时", Public: true},
	{Key: "alert_duration_seconds", Group: "一张图与预警", Label: "预警持续时间上限", Default: 2592000, Min: 1, Max: 31536000, Unit: "秒", Public: true},
	{Key: "export_points", Group: "导出任务", Label: "每指标单任务最大条数", Default: 10000000, Min: 100, Max: 100000000, Unit: "条", Public: false},
	{Key: "export_ttl_hours", Group: "导出任务", Label: "新任务文件有效期", Default: 72, Min: 1, Max: 8760, Unit: "小时", Public: false},
	{Key: "export_window_days", Group: "导出任务", Label: "后台分段查询窗口", Default: 30, Min: 1, Max: 366, Unit: "天", Public: false},
	{Key: "export_min_free_mb", Group: "导出任务", Label: "临时磁盘最小剩余空间", Default: 256, Min: 64, Max: 1048576, Unit: "MB", Public: false},
	{Key: "password_min_bytes", Group: "账号验证", Label: "密码最小长度", Default: 8, Min: 6, Max: 72, Unit: "字节", Public: true},
	{Key: "password_max_bytes", Group: "账号验证", Label: "密码最大长度", Default: 72, Min: 6, Max: 72, Unit: "字节", Public: true},
	{Key: "password_failed_attempts", Group: "账号验证", Label: "登录失败锁定阈值", Default: 5, Min: 1, Max: 100, Unit: "次", Public: false},
	{Key: "password_lock_minutes", Group: "账号验证", Label: "登录锁定时间", Default: 15, Min: 1, Max: 1440, Unit: "分钟", Public: false},
	{Key: "sms_ttl_seconds", Group: "账号验证", Label: "短信验证码有效期", Default: 300, Min: 30, Max: 86400, Unit: "秒", Public: true},
	{Key: "sms_cooldown_seconds", Group: "账号验证", Label: "短信验证码申请间隔", Default: 60, Min: 1, Max: 3600, Unit: "秒", Public: true},
	{Key: "sms_daily_limit", Group: "账号验证", Label: "每手机号每日验证码申请", Default: 10, Min: 1, Max: 10000, Unit: "次", Public: true},
	{Key: "sms_verify_attempts", Group: "账号验证", Label: "单个短信验证码尝试次数", Default: 5, Min: 1, Max: 100, Unit: "次", Public: false},
	{Key: "email_ttl_seconds", Group: "账号验证", Label: "邮箱验证码有效期", Default: 300, Min: 30, Max: 86400, Unit: "秒", Public: true},
	{Key: "email_cooldown_seconds", Group: "账号验证", Label: "邮箱验证码申请间隔", Default: 60, Min: 1, Max: 3600, Unit: "秒", Public: true},
	{Key: "email_daily_limit", Group: "账号验证", Label: "每邮箱每日验证码申请", Default: 10, Min: 1, Max: 10000, Unit: "次", Public: true},
	{Key: "email_verify_attempts", Group: "账号验证", Label: "单个邮箱验证码尝试次数", Default: 5, Min: 1, Max: 100, Unit: "次", Public: false},
	{Key: "public_history_hours", Group: "公开访问与 API", Label: "公开设备数据时间窗口", Default: 72, Min: 1, Max: 8760, Unit: "小时", Public: true},
	{Key: "public_telemetry_per_minute", Group: "公开访问与 API", Label: "公开设备指标请求频率", Default: 60, Min: 1, Max: 10000, Unit: "次/分钟", Public: false},
	{Key: "public_images_per_minute", Group: "公开访问与 API", Label: "公开设备图片请求频率", Default: 240, Min: 1, Max: 10000, Unit: "次/分钟", Public: false},
	{Key: "public_other_per_minute", Group: "公开访问与 API", Label: "公开设备其他接口频率", Default: 120, Min: 1, Max: 10000, Unit: "次/分钟", Public: false},
	{Key: "public_unlock_per_minute", Group: "公开访问与 API", Label: "公开设备解锁接口频率", Default: 60, Min: 1, Max: 10000, Unit: "次/分钟", Public: false},
	{Key: "public_password_attempts", Group: "公开访问与 API", Label: "公开密码尝试次数", Default: 5, Min: 1, Max: 100, Unit: "次", Public: false},
	{Key: "public_password_window_minutes", Group: "公开访问与 API", Label: "公开密码尝试统计窗口", Default: 15, Min: 1, Max: 1440, Unit: "分钟", Public: false},
	{Key: "api_per_minute", Group: "公开访问与 API", Label: "每 API 密钥请求频率", Default: 600, Min: 1, Max: 100000, Unit: "次/分钟", Public: false},
	{Key: "base_history_days", Group: "套餐参数", Label: "基础版最近可查询天数", Default: 90, Min: 1, Max: 36500, Unit: "天", Public: false},
	{Key: "base_export_days", Group: "套餐参数", Label: "基础版最近可导出天数", Default: 7, Min: 1, Max: 36500, Unit: "天", Public: false},
	{Key: "monthly_download_gb", Group: "套餐参数", Label: "专业版每月下载额度", Default: 100, Min: 1, Max: 1048576, Unit: "GB", Public: false},
}

type contextKey struct{}

func With(ctx context.Context, values Values) context.Context {
	return context.WithValue(ctx, contextKey{}, values)
}
func Int(ctx context.Context, key string, fallback int) int {
	if values, ok := ctx.Value(contextKey{}).(Values); ok {
		if value, exists := values[key]; exists {
			return value
		}
	}
	return fallback
}
func Context(contexts ...context.Context) context.Context {
	if len(contexts) > 0 && contexts[0] != nil {
		return contexts[0]
	}
	return context.Background()
}
func Password(ctx context.Context, fallback config.PasswordConfig) config.PasswordConfig {
	fallback.MinLength = Int(ctx, "password_min_bytes", fallback.MinLength)
	fallback.MaxLength = Int(ctx, "password_max_bytes", fallback.MaxLength)
	fallback.FailedAttemptLimit = Int(ctx, "password_failed_attempts", fallback.FailedAttemptLimit)
	fallback.LockMinutes = Int(ctx, "password_lock_minutes", fallback.LockMinutes)
	return fallback
}
func Query(ctx context.Context, fallback config.QueryLimitsConfig, field string) config.QueryLimitsConfig {
	fallback.MaxHistoryDays = Int(ctx, field, fallback.MaxHistoryDays)
	fallback.MaxPoints = Int(ctx, "query_points", fallback.MaxPoints)
	fallback.MaxMediaPageSize = Int(ctx, "media_page_size", fallback.MaxMediaPageSize)
	return fallback
}
func defaults(cfg config.Config) Values {
	values := Values{}
	for _, field := range definitions {
		values[field.Key] = field.Default
	}
	overrides := Values{
		"query_days": cfg.QueryLimits.MaxHistoryDays, "media_days": cfg.QueryLimits.MaxHistoryDays, "dataset_query_days": cfg.QueryLimits.MaxHistoryDays,
		"query_points": cfg.QueryLimits.MaxPoints, "media_page_size": cfg.QueryLimits.MaxMediaPageSize,
		"export_ttl_hours": cfg.Export.FileTTLHours, "export_min_free_mb": cfg.Export.MinFreeMB,
		"password_min_bytes": cfg.Auth.Password.MinLength, "password_max_bytes": min(cfg.Auth.Password.MaxLength, 72),
		"password_failed_attempts": cfg.Auth.Password.FailedAttemptLimit, "password_lock_minutes": cfg.Auth.Password.LockMinutes,
		"sms_ttl_seconds": cfg.SMS.CodeTTLSeconds, "sms_cooldown_seconds": cfg.SMS.CooldownSeconds, "sms_daily_limit": cfg.SMS.DailyLimit, "sms_verify_attempts": cfg.SMS.MaxVerifyAttempts,
		"email_ttl_seconds": cfg.Email.CodeTTLSeconds, "email_cooldown_seconds": cfg.Email.CooldownSeconds, "email_daily_limit": cfg.Email.DailyLimit, "email_verify_attempts": cfg.Email.MaxVerifyAttempts,
		"base_history_days": cfg.Billing.BaseHistoryDays, "base_export_days": cfg.Billing.BaseExportDays, "monthly_download_gb": int(cfg.Billing.MonthlyDownloadLimitGB),
	}
	if cfg.Billing.Enabled {
		values["billing_enabled"] = 1
	}
	for key, value := range overrides {
		if value > 0 {
			values[key] = value
		}
	}
	return values
}
func Validate(values Values) error {
	for key, value := range values {
		found := false
		for _, field := range definitions {
			if field.Key == key {
				found = true
				if value < field.Min || value > field.Max {
					return apperr.New(apperr.KindInvalidArgument, fmt.Sprintf("%s须为 %d–%d %s", field.Label, field.Min, field.Max, field.Unit))
				}
				break
			}
		}
		if !found {
			return apperr.New(apperr.KindInvalidArgument, "包含不支持的系统配置项："+key)
		}
	}
	if values["password_min_bytes"] > values["password_max_bytes"] {
		return apperr.New(apperr.KindInvalidArgument, "密码最小长度不能大于最大长度")
	}
	for _, channel := range []string{"sms", "email"} {
		if values[channel+"_cooldown_seconds"] > values[channel+"_ttl_seconds"] {
			return apperr.New(apperr.KindInvalidArgument, "验证码申请间隔不能大于验证码有效期")
		}
	}
	return nil
}

func HasSnapshot(ctx context.Context) bool { _, ok := ctx.Value(contextKey{}).(Values); return ok }
