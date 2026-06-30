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
	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/accessgrant"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/dataset"
	"thcpn-gin/internal/datastream"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/member"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/project"
	"thcpn-gin/internal/site"
	smsx "thcpn-gin/internal/sms"
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
	router.Use(httpx.AccessLog(deps.Logger))

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, statusResponse{Status: "ok"})
	})
	router.GET("/readyz", readyHandler(deps))

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
	datasetService := dataset.NewService(deps.Postgres)
	tokenManager := auth.NewTokenManager(cfg.Auth.JWTSecret, time.Duration(cfg.Auth.AccessTokenTTLMinutes)*time.Minute)
	smsSender, err := newSMSSender(cfg.SMS, deps.Logger)
	if err != nil {
		return err
	}
	smsCodeStore := auth.NewSMSCodeStore(deps.Redis, cfg.Auth.JWTSecret, cfg.SMS)
	authService := auth.NewService(deps.Postgres, tokenManager, smsCodeStore, smsSender, cfg.Auth, cfg.SMS)

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
	projectHandler := project.NewHandler(projectService, permissionChecker)
	siteHandler := site.NewHandler(siteService, permissionChecker)
	deviceHandler := device.NewHandler(deviceService, permissionChecker, auditService)
	dataStreamHandler := datastream.NewHandler(dataStreamService, permissionChecker)
	datasetHandler := dataset.NewHandler(datasetService, permissionChecker, auditService)
	authMiddleware := auth.Middleware(userService, auth.MiddlewareConfig{
		TokenManager:         tokenManager,
		DevUserHeaderEnabled: cfg.Auth.DevUserHeaderEnabled,
	})

	api := router.Group("/api/v1")
	api.POST("/auth/sms/send", authHandler.SendSMS)
	api.POST("/auth/sms/login", authHandler.LoginWithSMS)
	api.POST("/auth/password/register", authHandler.RegisterWithPassword)
	api.POST("/auth/password/login", authHandler.LoginWithPassword)
	if cfg.Auth.DevRegisterEnabled {
		api.POST("/auth/register", userHandler.Register)
	} else {
		api.POST("/auth/register", func(c *gin.Context) {
			httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "dev registration is disabled"))
		})
	}

	authed := api.Group("")
	authed.Use(authMiddleware)
	authed.GET("/me", userHandler.Me)
	authed.GET("/workspaces", workspaceHandler.List)
	authed.POST("/workspaces", workspaceHandler.Create)
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
	authed.GET("/devices/:device_id", deviceHandler.Get)
	authed.PATCH("/devices/:device_id", deviceHandler.Update)
	authed.GET("/data-streams", dataStreamHandler.List)
	authed.POST("/data-streams", dataStreamHandler.Create)
	authed.GET("/data-streams/:data_stream_id", dataStreamHandler.Get)
	authed.PATCH("/data-streams/:data_stream_id", dataStreamHandler.Update)
	authed.GET("/datasets", datasetHandler.List)
	authed.POST("/datasets", datasetHandler.Create)
	authed.GET("/datasets/:dataset_id", datasetHandler.Get)
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
