package app

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/accessgrant"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/dataset"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/datastream"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/device"
	emailx "thcpn-gin/internal/email"
	"thcpn-gin/internal/export"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/media"
	"thcpn-gin/internal/member"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/project"
	"thcpn-gin/internal/site"
	smsx "thcpn-gin/internal/sms"
	"thcpn-gin/internal/task"
	"thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/user"
	"thcpn-gin/internal/workspace"
)

type Dependencies struct {
	Logger   *slog.Logger
	Postgres *pgxpool.Pool
	Redis    *redis.Client
	Config   config.Config
}

type statusResponse struct {
	Status string `json:"status"`
}

func NewRouter(deps Dependencies) (*gin.Engine, error) {
	gin.SetMode(gin.ReleaseMode)

	cfg := deps.Config
	if cfg.Auth.JWTSecret == "" {
		cfg = config.Default()
	}

	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(httpx.RequestID())
	if cfg.Tracing.Enabled {
		router.Use(httpx.Trace(cfg.Tracing.ServiceName, "/metrics"))
	}
	router.Use(httpx.Metrics())
	router.Use(httpx.AccessLog(deps.Logger))

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, statusResponse{Status: "ok"})
	})
	router.GET("/readyz", readyHandler(deps))
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	if deps.Postgres != nil {
		if err := registerAPIV1(router, deps, cfg); err != nil {
			return nil, err
		}
	}

	return router, nil
}

func registerAPIV1(router *gin.Engine, deps Dependencies, cfg config.Config) error {
	userService := user.NewService(deps.Postgres)
	workspaceService := workspace.NewService(deps.Postgres)
	permissionChecker := permission.NewChecker(sqlc.New(deps.Postgres))
	auditService := audit.NewService(deps.Postgres)
	memberService := member.NewService(deps.Postgres)
	accessGrantService := accessgrant.NewService(deps.Postgres)
	projectService := project.NewService(deps.Postgres)
	siteService := site.NewService(deps.Postgres)
	deviceService := device.NewService(deps.Postgres)
	dataStreamService := datastream.NewService(deps.Postgres)
	dataSourceService := datasource.NewService(deps.Postgres)
	datasetService := dataset.NewService(deps.Postgres, dataset.QueryDependencies{
		DataSources: dataSourceService,
		Runtime:     datasource.NewRuntime(nil),
		Limits:      cfg.QueryLimits,
	})
	telemetryService := telemetry.NewService(deps.Postgres, dataSourceService, datasource.NewRuntime(nil), cfg.QueryLimits)
	objectSigner := objectstore.NewSigner(cfg.ObjectStore, cfg.Auth.JWTSecret)
	objectStore := objectstore.NewStore(cfg.ObjectStore)
	objectHandler := objectstore.NewHandler(objectStore, objectSigner)
	mediaService := media.NewService(deps.Postgres, dataSourceService, datasource.NewRuntime(nil), objectSigner, cfg.QueryLimits, objectStore)
	exportService := export.NewService(deps.Postgres, objectSigner, cfg.Export)
	tokenManager := auth.NewTokenManager(cfg.Auth.JWTSecret, time.Duration(cfg.Auth.AccessTokenTTLMinutes)*time.Minute)
	smsSender, err := newSMSSender(cfg.SMS, deps.Logger)
	if err != nil {
		return err
	}
	smsCodeStore := auth.NewSMSCodeStore(deps.Redis, cfg.Auth.JWTSecret, cfg.SMS)
	emailSender, err := newEmailSender(cfg.Email, deps.Logger)
	if err != nil {
		return err
	}
	emailCodeStore := auth.NewEmailCodeStore(deps.Redis, cfg.Auth.JWTSecret, cfg.Email)
	authService := auth.NewService(deps.Postgres, tokenManager, smsCodeStore, smsSender, emailCodeStore, emailSender, cfg.Auth, cfg.SMS, cfg.Email)

	authHandler := auth.NewHandler(authService, auditService)
	userHandler := user.NewHandler(userService)
	workspaceHandler := workspace.NewHandler(workspaceService, auditService)
	memberHandler := member.NewHandler(memberService, permissionChecker, auditService)
	accessGrantHandler := accessgrant.NewHandler(accessGrantService, permissionChecker, auditService)
	auditHandler := audit.NewHandler(auditService, permissionChecker, func(c *gin.Context) (uuid.UUID, bool) {
		actor, ok := auth.ActorFromContext(c)
		if !ok {
			return uuid.Nil, false
		}
		return actor.UserID, true
	})
	projectHandler := project.NewHandler(projectService, permissionChecker, auditService)
	siteHandler := site.NewHandler(siteService, permissionChecker, auditService)
	deviceHandler := device.NewHandler(deviceService, permissionChecker, auditService)
	dataStreamHandler := datastream.NewHandler(dataStreamService, permissionChecker, auditService)
	datasetHandler := dataset.NewHandler(datasetService, permissionChecker, auditService)
	dataSourceHandler := datasource.NewHandler(dataSourceService, permissionChecker)
	telemetryHandler := telemetry.NewHandler(telemetryService, permissionChecker)
	mediaHandler := media.NewHandler(mediaService, permissionChecker, auditService)
	exportHandler := export.NewHandler(exportService, permissionChecker, auditService)
	if taskClient := task.NewClient(deps.Redis); taskClient != nil {
		exportHandler.SetJobEnqueuer(taskClient)
	}
	authMiddleware := auth.Middleware(userService, auth.MiddlewareConfig{
		TokenManager:         tokenManager,
		RevocationChecker:    authService,
		DevUserHeaderEnabled: cfg.Auth.DevUserHeaderEnabled,
	})

	api := router.Group("/api/v1")
	api.GET("/objects/download", objectHandler.Download)
	api.POST("/auth/sms/send", authHandler.SendSMS)
	api.POST("/auth/sms/login", authHandler.LoginWithSMS)
	api.POST("/auth/password/register", authHandler.RegisterWithPassword)
	api.POST("/auth/password/login", authHandler.LoginWithPassword)
	api.POST("/auth/refresh", authHandler.Refresh)
	if cfg.Auth.DevRegisterEnabled {
		api.POST("/auth/register", userHandler.Register)
	} else {
		api.POST("/auth/register", func(c *gin.Context) {
			httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "dev registration is disabled"))
		})
	}

	authed := api.Group("")
	authed.Use(authMiddleware)
	authed.POST("/auth/logout", authHandler.Logout)
	authed.GET("/auth/sessions", authHandler.ListSessions)
	authed.DELETE("/auth/sessions/:session_id", authHandler.RevokeSession)
	authed.POST("/auth/email/send", authHandler.SendEmailVerification)
	authed.POST("/auth/email/verify", authHandler.VerifyEmail)
	authed.GET("/auth/mfa", authHandler.MFAStatus)
	authed.POST("/auth/mfa/totp/setup", authHandler.SetupTOTP)
	authed.POST("/auth/mfa/totp/enable", authHandler.EnableTOTP)
	authed.DELETE("/auth/mfa/totp", authHandler.DisableTOTP)
	authed.GET("/me", userHandler.Me)
	authed.GET("/workspaces", workspaceHandler.List)
	authed.POST("/workspaces", workspaceHandler.Create)
	admin := authed.Group("/admin")
	admin.Use(auth.RequireSystemAdmin())
	admin.GET("/workspaces", workspaceHandler.AdminList)
	admin.GET("/projects", projectHandler.AdminList)
	admin.GET("/sites", siteHandler.AdminList)
	admin.GET("/data-sources", dataSourceHandler.AdminListDataSources)
	admin.POST("/data-sources", dataSourceHandler.AdminCreateDataSource)
	admin.PATCH("/data-sources/:data_source_id", dataSourceHandler.AdminUpdateDataSource)
	admin.POST("/data-sources/:data_source_id/thcpn-standard-station/devices", dataSourceHandler.AdminSyncTHCPNStandardStation)
	authed.GET("/workspaces/:workspace_id/members", memberHandler.List)
	authed.POST("/workspaces/:workspace_id/members", memberHandler.Add)
	authed.PATCH("/workspaces/:workspace_id/members/:member_id", memberHandler.UpdateRole)
	authed.DELETE("/workspaces/:workspace_id/members/:member_id", memberHandler.Remove)
	authed.GET("/access-grants", accessGrantHandler.ListGrants)
	authed.POST("/access-grants", accessGrantHandler.CreateGrant)
	authed.GET("/access-grants/mine", accessGrantHandler.ListMyGrants)
	authed.DELETE("/access-grants/:access_grant_id", accessGrantHandler.RevokeGrant)
	authed.GET("/invitations", accessGrantHandler.ListInvitations)
	authed.POST("/invitations", accessGrantHandler.CreateInvitation)
	authed.GET("/invitations/mine", accessGrantHandler.ListMyInvitations)
	authed.POST("/invitations/:invitation_id/accept", accessGrantHandler.AcceptInvitation)
	authed.DELETE("/invitations/:invitation_id", accessGrantHandler.RevokeInvitation)
	authed.GET("/audit-logs", auditHandler.List)
	authed.GET("/media/download", mediaHandler.Download)
	authed.DELETE("/media", mediaHandler.Delete)
	authed.GET("/export-jobs", exportHandler.List)
	authed.POST("/export-jobs", exportHandler.Create)
	authed.GET("/export-jobs/:export_job_id", exportHandler.Get)
	authed.GET("/export-jobs/:export_job_id/download", exportHandler.Download)
	authed.GET("/projects", projectHandler.List)
	authed.POST("/projects", projectHandler.Create)
	authed.GET("/projects/:project_id", projectHandler.Get)
	authed.PATCH("/projects/:project_id", projectHandler.Update)
	authed.GET("/sites", siteHandler.List)
	authed.POST("/sites", siteHandler.Create)
	authed.GET("/sites/:site_id", siteHandler.Get)
	authed.PATCH("/sites/:site_id", siteHandler.Update)
	authed.GET("/devices", deviceHandler.List)
	authed.POST("/devices", deviceHandler.Create)
	authed.GET("/devices/:device_id/telemetry", telemetryHandler.QueryDevice)
	authed.GET("/devices/:device_id/media", mediaHandler.ListDevice)
	authed.GET("/devices/:device_id/media/images", mediaHandler.ListDeviceImages)
	authed.GET("/devices/:device_id/media/videos", mediaHandler.ListDeviceVideos)
	authed.POST("/devices/:device_id/calibrations", deviceHandler.RequestCalibration)
	authed.POST("/devices/:device_id/firmware-upgrades", deviceHandler.RequestFirmwareUpgrade)
	authed.POST("/devices/:device_id/transfer", deviceHandler.Transfer)
	authed.POST("/devices/:device_id/unbind", deviceHandler.Unbind)
	authed.GET("/devices/:device_id", deviceHandler.Get)
	authed.PATCH("/devices/:device_id", deviceHandler.Update)
	authed.GET("/data-streams", dataStreamHandler.List)
	authed.POST("/data-streams", dataStreamHandler.Create)
	authed.GET("/data-streams/:data_stream_id/telemetry", telemetryHandler.QueryDataStream)
	authed.GET("/data-streams/:data_stream_id/media", mediaHandler.ListDataStream)
	authed.GET("/data-streams/:data_stream_id", dataStreamHandler.Get)
	authed.PATCH("/data-streams/:data_stream_id", dataStreamHandler.Update)
	authed.GET("/data-sources", dataSourceHandler.ListDataSources)
	authed.POST("/data-sources", dataSourceHandler.CreateDataSource)
	authed.POST("/data-sources/:data_source_id/thcpn-standard-station/devices", dataSourceHandler.SyncTHCPNStandardStation)
	authed.GET("/data-sources/:data_source_id", dataSourceHandler.GetDataSource)
	authed.PATCH("/data-sources/:data_source_id", dataSourceHandler.UpdateDataSource)
	authed.GET("/data-stream-bindings", dataSourceHandler.ListBindings)
	authed.POST("/data-stream-bindings", dataSourceHandler.CreateBinding)
	authed.GET("/data-stream-bindings/:binding_id", dataSourceHandler.GetBinding)
	authed.PATCH("/data-stream-bindings/:binding_id", dataSourceHandler.UpdateBinding)
	authed.GET("/datasets", datasetHandler.List)
	authed.POST("/datasets", datasetHandler.Create)
	authed.GET("/datasets/:dataset_id", datasetHandler.Get)
	authed.GET("/datasets/:dataset_id/telemetry", datasetHandler.QueryTelemetry)
	authed.POST("/datasets/:dataset_id/export", exportHandler.ExportDataset)
	authed.PATCH("/datasets/:dataset_id", datasetHandler.Update)
	authed.DELETE("/datasets/:dataset_id", datasetHandler.Delete)
	return nil
}

func newSMSSender(cfg config.SMSConfig, logger *slog.Logger) (smsx.Sender, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "log", "":
		return smsx.LogSender{Logger: logger}, nil
	case "noop":
		return smsx.NoopSender{}, nil
	case "aliyun":
		return smsx.NewAliyunSender(cfg)
	default:
		return nil, apperr.New(apperr.KindInvalidArgument, "unsupported sms provider")
	}
}

func newEmailSender(cfg config.EmailConfig, logger *slog.Logger) (emailx.Sender, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "log", "":
		return emailx.LogSender{Logger: logger}, nil
	case "noop":
		return emailx.NoopSender{}, nil
	default:
		return nil, apperr.New(apperr.KindInvalidArgument, "unsupported email provider")
	}
}

func readyHandler(deps Dependencies) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()

		if err := db.PingPostgres(ctx, deps.Postgres); err != nil {
			httpx.WriteError(c, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "postgres is not ready")
			return
		}

		if err := db.PingRedis(ctx, deps.Redis); err != nil {
			httpx.WriteError(c, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "redis is not ready")
			return
		}

		c.JSON(http.StatusOK, statusResponse{Status: "ok"})
	}
}
