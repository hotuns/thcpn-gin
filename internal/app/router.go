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
	"thcpn-gin/internal/adminauth"
	"thcpn-gin/internal/adminuser"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/camera"
	"thcpn-gin/internal/computedstream"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/dataset"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/datastream"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/deviceclaim"
	"thcpn-gin/internal/deviceclassification"
	"thcpn-gin/internal/deviceprofile"
	emailx "thcpn-gin/internal/email"
	"thcpn-gin/internal/export"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/media"
	"thcpn-gin/internal/member"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/platformlog"
	"thcpn-gin/internal/processing"
	"thcpn-gin/internal/project"
	"thcpn-gin/internal/publicdevice"
	"thcpn-gin/internal/site"
	smsx "thcpn-gin/internal/sms"
	"thcpn-gin/internal/task"
	"thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/user"
	"thcpn-gin/internal/workspace"
)

type Dependencies struct {
	Logger       *slog.Logger
	Postgres     *pgxpool.Pool
	Redis        *redis.Client
	Config       config.Config
	PlatformLogs *platformlog.Store
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
	permissionCatalogService := permission.NewCatalogService(deps.Postgres)
	auditService := audit.NewService(deps.Postgres)
	platformLogHandler := platformlog.NewHandler(deps.PlatformLogs, auditService)
	memberService := member.NewService(deps.Postgres)
	accessGrantService := accessgrant.NewService(deps.Postgres)
	projectService := project.NewService(deps.Postgres)
	siteService := site.NewService(deps.Postgres)
	deviceService := device.NewService(deps.Postgres)
	deviceClaimService := deviceclaim.NewService(deps.Postgres, cfg.Auth.JWTSecret)
	cameraService := camera.NewService(deps.Postgres, cfg.Ezviz)
	dataStreamService := datastream.NewService(deps.Postgres)
	computedStreamService := computedstream.NewService(deps.Postgres)
	dataSourceService := datasource.NewService(deps.Postgres)
	telemetryService := telemetry.NewService(deps.Postgres, dataSourceService, datasource.NewRuntime(nil), cfg.QueryLimits, computedStreamService)
	datasetService := dataset.NewService(deps.Postgres, dataset.QueryDependencies{
		DataSources: dataSourceService,
		Runtime:     datasource.NewRuntime(nil),
		Limits:      cfg.QueryLimits,
		Telemetry:   telemetryService,
	})
	objectSigner := objectstore.NewSigner(cfg.ObjectStore, cfg.Auth.JWTSecret)
	thcpnLogSigner := objectstore.NewSigner(cfg.THCPNLogObjectStore, cfg.Auth.JWTSecret)
	objectStore := objectstore.NewStore(cfg.ObjectStore)
	objectHandler := objectstore.NewHandler(objectStore, objectSigner)
	deviceProfileService := deviceprofile.NewService(deps.Postgres, objectStore, objectSigner, func(ctx context.Context, deviceID uuid.UUID) (deviceprofile.SourceLocation, bool, error) {
		locations, err := dataSourceService.LiveTHCPNDeviceLocations(ctx, []uuid.UUID{deviceID})
		if err != nil {
			return deviceprofile.SourceLocation{}, false, err
		}
		location, found := locations[deviceID]
		return deviceprofile.SourceLocation{Latitude: location.Latitude, Longitude: location.Longitude}, found, nil
	})
	deviceClassificationService := deviceclassification.NewService(deps.Postgres, func(ctx context.Context, deviceIDs []uuid.UUID) (map[uuid.UUID]deviceclassification.SourceLocation, error) {
		locations, err := dataSourceService.LiveTHCPNDeviceLocations(ctx, deviceIDs)
		if err != nil {
			return nil, err
		}
		result := make(map[uuid.UUID]deviceclassification.SourceLocation, len(locations))
		for deviceID, location := range locations {
			result[deviceID] = deviceclassification.SourceLocation{
				Latitude: location.Latitude, Longitude: location.Longitude, AltitudeM: location.AltitudeM,
			}
		}
		return result, nil
	})
	mediaService := media.NewService(deps.Postgres, dataSourceService, datasource.NewRuntime(nil), objectSigner, cfg.QueryLimits, objectStore)
	publicDeviceService := publicdevice.NewService(deps.Postgres)
	exportService := export.NewService(deps.Postgres, objectSigner, cfg.Export)
	processingService := processing.NewService(deps.Postgres, processing.NewClient(cfg.Processing.ProcessorURL))
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
	adminUserService := adminuser.NewService(deps.Postgres, cfg.Auth.Password)
	adminTokenManager := auth.NewTokenManager(cfg.Auth.AdminJWTSecret, time.Duration(cfg.Auth.AccessTokenTTLMinutes)*time.Minute)
	adminAuthService := adminauth.NewService(deps.Postgres, adminTokenManager, time.Duration(cfg.Auth.AccessTokenTTLMinutes)*time.Minute, time.Duration(cfg.Auth.RefreshTokenTTLDays)*24*time.Hour)

	authHandler := auth.NewHandler(authService, auditService)
	adminUserHandler := adminuser.NewHandler(adminUserService, auditService)
	adminAuthHandler := adminauth.NewHandler(adminAuthService)
	userHandler := user.NewHandler(userService, auditService)
	workspaceHandler := workspace.NewHandlerWithChecker(workspaceService, permissionChecker, auditService)
	memberHandler := member.NewHandler(memberService, permissionChecker, auditService)
	accessGrantHandler := accessgrant.NewHandler(accessGrantService, permissionChecker, auditService)
	permissionCatalogHandler := permission.NewCatalogHandler(permissionCatalogService)
	auditHandler := audit.NewHandler(auditService, permissionChecker, func(c *gin.Context) (uuid.UUID, bool) {
		actor, ok := auth.ActorFromContext(c)
		if !ok {
			return uuid.Nil, false
		}
		return actor.UserID, true
	}, func(c *gin.Context) bool {
		actor, ok := auth.ActorFromContext(c)
		return ok && actor.IsSystemAdmin
	})
	projectHandler := project.NewHandler(projectService, permissionChecker, auditService)
	siteHandler := site.NewHandler(siteService, permissionChecker, auditService)
	deviceHandler := device.NewHandler(deviceService, permissionChecker, auditService)
	deviceProfileHandler := deviceprofile.NewHandler(deviceProfileService, permissionChecker, auditService)
	deviceClassificationHandler := deviceclassification.NewHandler(deviceClassificationService, permissionChecker, auditService)
	cameraHandler := camera.NewHandler(cameraService, permissionChecker, auditService)
	dataStreamHandler := datastream.NewHandler(dataStreamService, permissionChecker, auditService)
	computedStreamHandler := computedstream.NewHandler(computedStreamService, permissionChecker, auditService)
	datasetHandler := dataset.NewHandler(datasetService, permissionChecker, auditService)
	dataSourceHandler := datasource.NewHandler(dataSourceService, permissionChecker, auditService)
	deviceClaimHandler := deviceclaim.NewHandler(deviceClaimService, permissionChecker, auditService)
	dataSourceHandler.SetClaimCredentialEnsurer(deviceClaimService)
	dataSourceHandler.SetTHCPNLogSigner(thcpnLogSigner)
	telemetryHandler := telemetry.NewHandler(telemetryService, permissionChecker)
	mediaHandler := media.NewHandler(mediaService, permissionChecker, auditService)
	publicDeviceHandler := publicdevice.NewHandler(publicDeviceService, telemetryService, mediaService, permissionChecker, auditService, deps.Redis, cfg.Auth.JWTSecret)
	exportHandler := export.NewHandler(exportService, permissionChecker, auditService)
	processingHandler := processing.NewHandler(processingService, permissionChecker)
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
	api.POST("/auth/password/complete-initial", authHandler.CompleteInitialPassword)
	api.POST("/auth/refresh", authHandler.Refresh)
	api.POST("/admin/auth/password/login", adminAuthHandler.Login)
	api.GET("/public/devices/:public_slug", publicDeviceHandler.GetPublic)
	api.POST("/public/devices/:public_slug/unlock", publicDeviceHandler.Unlock)
	api.GET("/public/devices/:public_slug/telemetry", publicDeviceHandler.Telemetry)
	api.GET("/public/devices/:public_slug/images", publicDeviceHandler.Images)
	api.GET("/device-claims/:claim_slug", deviceClaimHandler.PublicEntry)
	api.POST("/admin/auth/refresh", adminAuthHandler.Refresh)
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
	authed.POST("/device-claims/resolve", deviceClaimHandler.Resolve)
	authed.POST("/device-claims/claim", deviceClaimHandler.Claim)
	authed.PATCH("/me", userHandler.UpdateMe)
	authed.POST("/auth/password/change", authHandler.ChangePassword)
	authed.GET("/workspaces", workspaceHandler.List)
	authed.POST("/workspaces", workspaceHandler.Create)
	authed.PATCH("/workspaces/:workspace_id", workspaceHandler.UpdateName)
	authed.GET("/permissions/catalog", permissionCatalogHandler.Catalog)
	authed.GET("/device-taxonomy/catalog", deviceClassificationHandler.Catalog)
	admin := api.Group("/admin")
	admin.Use(adminauth.Middleware(adminTokenManager, adminAuthService))
	admin.GET("/me", adminAuthHandler.Me)
	admin.GET("/users", adminUserHandler.List)
	admin.POST("/users", adminUserHandler.Create)
	admin.GET("/users/:user_id", adminUserHandler.Get)
	admin.PATCH("/users/:user_id", adminUserHandler.Update)
	admin.PATCH("/users/:user_id/status", adminUserHandler.Status)
	admin.POST("/users/:user_id/sessions/revoke-all", adminUserHandler.RevokeAllSessions)
	admin.POST("/users/:user_id/unlock", adminUserHandler.Unlock)
	admin.DELETE("/users/:user_id/mfa", adminUserHandler.ResetMFA)
	admin.POST("/users/:user_id/temporary-password", adminUserHandler.TemporaryPassword)
	admin.DELETE("/users/:user_id", adminUserHandler.Delete)
	admin.GET("/users/:user_id/deletion-check", adminUserHandler.DeletionCheck)
	admin.GET("/users/:user_id/workspaces", adminUserHandler.Workspaces)
	admin.GET("/users/:user_id/sessions", adminUserHandler.Sessions)
	admin.GET("/users/:user_id/activity", adminUserHandler.Activity)
	admin.POST("/auth/logout", adminAuthHandler.Logout)
	admin.GET("/permissions/catalog", permissionCatalogHandler.Catalog)
	admin.GET("/workspaces", workspaceHandler.AdminList)
	admin.GET("/workspaces/:workspace_id", workspaceHandler.AdminGet)
	admin.PATCH("/workspaces/:workspace_id/status", workspaceHandler.RequireAdminReason(), workspaceHandler.AdminUpdateStatus)
	admin.POST("/workspaces/:workspace_id/transfer-owner", workspaceHandler.RequireAdminReason(), workspaceHandler.AdminTransferOwner)
	admin.GET("/projects", projectHandler.AdminList)
	admin.GET("/sites", siteHandler.AdminList)
	admin.GET("/sites/:site_id/environment", deviceClassificationHandler.AdminGetSite)
	admin.PATCH("/sites/:site_id/environment", deviceClassificationHandler.AdminUpdateSite)
	admin.GET("/metadata/device-capabilities", deviceHandler.AdminListCapabilityDefinitions)
	admin.GET("/metadata/device-taxonomy", deviceClassificationHandler.AdminCatalog)
	admin.POST("/metadata/device-taxonomy", deviceClassificationHandler.AdminUpsertTerm)
	admin.POST("/metadata/device-capabilities", deviceHandler.AdminCreateCapabilityDefinition)
	admin.PATCH("/metadata/device-capabilities/:code", deviceHandler.AdminUpdateCapabilityDefinition)
	admin.GET("/metadata/system-roles", deviceHandler.AdminListSystemRoles)
	admin.PATCH("/metadata/system-roles/:code", deviceHandler.AdminUpdateSystemRole)
	admin.POST("/cameras", cameraHandler.AdminCreate)
	admin.GET("/cameras/:device_id", cameraHandler.AdminGet)
	admin.PATCH("/cameras/:device_id", cameraHandler.AdminUpdate)
	admin.GET("/devices", deviceHandler.AdminListSystemAssets)
	admin.GET("/device-map", deviceClassificationHandler.AdminMap)
	admin.POST("/devices/environment/bulk", deviceClassificationHandler.AdminBulkUpdate)
	admin.POST("/device-claims/ensure", deviceClaimHandler.AdminEnsureAll)
	admin.GET("/devices/:device_id/claim-credential", deviceClaimHandler.AdminCredential)
	admin.POST("/devices/:device_id/claim-credential/printed", deviceClaimHandler.AdminMarkPrinted)
	admin.PATCH("/devices/:device_id", deviceHandler.AdminUpdate)
	admin.GET("/devices/:device_id/environment", deviceClassificationHandler.AdminGet)
	admin.PATCH("/devices/:device_id/environment", deviceClassificationHandler.AdminUpdate)
	admin.GET("/devices/:device_id/lifecycle", deviceHandler.AdminLifecycle)
	admin.PATCH("/devices/:device_id/lifecycle", deviceHandler.AdminUpdateLifecycle)
	admin.GET("/devices/:device_id/capabilities", deviceHandler.AdminCapabilities)
	admin.PATCH("/devices/:device_id/capabilities", deviceHandler.AdminUpdateCapabilities)
	admin.GET("/devices/:device_id/thcpn-config", dataSourceHandler.AdminGetTHCPNDeviceConfig)
	admin.POST("/devices/:device_id/thcpn-config", dataSourceHandler.AdminUpdateTHCPNDeviceConfig)
	admin.GET("/devices/:device_id/sensor-templates", dataSourceHandler.AdminListTHCPNSensorTemplates)
	admin.GET("/sensor-templates", dataSourceHandler.AdminListSensorTemplates)
	admin.POST("/sensor-templates", dataSourceHandler.AdminCreateSensorTemplate)
	admin.POST("/sensor-templates/import", dataSourceHandler.AdminImportSensorTemplates)
	admin.GET("/sensor-templates/:template_id", dataSourceHandler.AdminGetSensorTemplate)
	admin.PUT("/sensor-templates/:template_id", dataSourceHandler.AdminUpdateSensorTemplate)
	admin.DELETE("/sensor-templates/:template_id", dataSourceHandler.AdminDeleteSensorTemplate)
	admin.GET("/devices/:device_id/attributes/latest", dataSourceHandler.AdminLatestTHCPNDeviceAttributes)
	admin.GET("/devices/runtime", dataSourceHandler.AdminTHCPNDeviceRuntime)
	admin.GET("/devices/:device_id/logs", dataSourceHandler.AdminListTHCPNDeviceLogs)
	admin.GET("/devices/:device_id/logs/:log_uuid/preview", dataSourceHandler.AdminPreviewTHCPNDeviceLog)
	admin.GET("/devices/:device_id/logs/:log_uuid/download", dataSourceHandler.AdminDownloadTHCPNDeviceLog)
	admin.POST("/devices/:device_id/assignment", deviceHandler.AdminAssign)
	admin.DELETE("/devices/:device_id/assignment", deviceHandler.AdminUnassign)
	admin.POST("/devices/:device_id/calibrations", deviceHandler.AdminRequestCalibration)
	admin.POST("/devices/:device_id/firmware-upgrades", deviceHandler.AdminRequestFirmwareUpgrade)
	admin.POST("/devices/:device_id/children", deviceHandler.AdminAddChild)
	admin.DELETE("/devices/:device_id/children/:child_device_id", deviceHandler.AdminRemoveChild)
	admin.GET("/data-sources", dataSourceHandler.AdminListDataSources)
	admin.POST("/data-sources", dataSourceHandler.AdminCreateDataSource)
	admin.PATCH("/data-sources/:data_source_id", dataSourceHandler.AdminUpdateDataSource)
	admin.POST("/data-sources/:data_source_id/thcpn-standard-station/devices", dataSourceHandler.AdminSyncTHCPNStandardStation)
	admin.POST("/data-sources/:data_source_id/thcpn-standard-station/devices/sync-all", dataSourceHandler.AdminSyncAllTHCPNDevices)
	admin.POST("/data-sources/:data_source_id/thcpn-standard-station/gateways", dataSourceHandler.AdminSyncTHCPNGateway)
	admin.POST("/data-sources/:data_source_id/thcpn-standard-station/cameras", dataSourceHandler.AdminSyncTHCPNCamera)
	admin.GET("/workspaces/:workspace_id/members", memberHandler.List)
	admin.POST("/workspaces/:workspace_id/members", workspaceHandler.RequireAdminReason(), memberHandler.Add)
	admin.PATCH("/workspaces/:workspace_id/members/:member_id", workspaceHandler.RequireAdminReason(), memberHandler.UpdateRole)
	admin.DELETE("/workspaces/:workspace_id/members/:member_id", workspaceHandler.RequireAdminReason(), memberHandler.Remove)
	admin.GET("/access-grants", accessGrantHandler.ListGrants)
	admin.POST("/access-grants", workspaceHandler.TenantManagedOperation)
	admin.DELETE("/access-grants/:access_grant_id", workspaceHandler.RequireAdminReason(), accessGrantHandler.RevokeGrant)
	admin.GET("/invitations", accessGrantHandler.ListInvitations)
	admin.POST("/invitations", workspaceHandler.TenantManagedOperation)
	admin.DELETE("/invitations/:invitation_id", workspaceHandler.RequireAdminReason(), accessGrantHandler.RevokeInvitation)
	admin.GET("/audit-logs", auditHandler.List)
	admin.GET("/platform-logs", platformLogHandler.List)
	admin.GET("/platform-logs/export", platformLogHandler.Export)
	admin.GET("/platform-logs/policy", platformLogHandler.Policy)
	admin.GET("/platform-logs/files", platformLogHandler.Files)
	admin.GET("/platform-logs/files/:file_name/download", platformLogHandler.DownloadFile)
	admin.GET("/platform-logs/:log_id", platformLogHandler.Get)
	admin.POST("/platform-logs/index/rebuild", platformLogHandler.Rebuild)
	admin.POST("/projects", workspaceHandler.TenantManagedOperation)
	admin.PATCH("/projects/:project_id", workspaceHandler.RequireAdminReason(), projectHandler.Update)
	admin.POST("/sites", workspaceHandler.TenantManagedOperation)
	admin.PATCH("/sites/:site_id", workspaceHandler.RequireAdminReason(), siteHandler.Update)
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
	authed.GET("/sites/:site_id/environment", deviceClassificationHandler.GetSite)
	authed.PATCH("/sites/:site_id/environment", deviceClassificationHandler.UpdateSite)
	authed.GET("/devices", deviceHandler.List)
	authed.GET("/device-map", deviceClassificationHandler.Map)
	admin.GET("/devices/:device_id/children", deviceHandler.AdminChildren)
	authed.GET("/devices/:device_id/children", deviceHandler.Children)
	authed.POST("/devices/:device_id/camera/live-session", cameraHandler.CreateLiveSession)
	authed.GET("/devices/:device_id/telemetry", telemetryHandler.QueryDevice)
	authed.GET("/devices/:device_id/metadata", computedStreamHandler.ListMetadata)
	authed.PUT("/devices/:device_id/metadata", computedStreamHandler.ReplaceMetadata)
	authed.GET("/devices/:device_id/computed-streams", computedStreamHandler.List)
	authed.POST("/devices/:device_id/computed-streams", computedStreamHandler.Create)
	authed.PATCH("/devices/:device_id/computed-streams/:data_stream_id", computedStreamHandler.Update)
	authed.DELETE("/devices/:device_id/computed-streams/:data_stream_id", computedStreamHandler.Delete)
	authed.POST("/devices/:device_id/computed-streams/preview", computedStreamHandler.Preview)
	authed.GET("/devices/:device_id/attributes/latest", dataSourceHandler.LatestTHCPNDeviceAttributes)
	authed.GET("/devices/runtime", dataSourceHandler.THCPNDeviceRuntime)
	authed.GET("/devices/:device_id/sampling-profile", dataSourceHandler.GetSamplingProfile)
	authed.PATCH("/devices/:device_id/sampling-profile", dataSourceHandler.UpdateSamplingProfile)
	authed.GET("/devices/:device_id/media", mediaHandler.ListDevice)
	authed.GET("/devices/:device_id/media/images", mediaHandler.ListDeviceImages)
	authed.GET("/devices/:device_id/media/videos", mediaHandler.ListDeviceVideos)
	authed.GET("/devices/:device_id/public-access", publicDeviceHandler.GetManagement)
	authed.PATCH("/devices/:device_id/public-access", publicDeviceHandler.UpdateManagement)
	authed.POST("/devices/:device_id/unbind", deviceHandler.Unbind)
	authed.GET("/devices/:device_id", deviceHandler.Get)
	authed.PATCH("/devices/:device_id", deviceHandler.Update)
	authed.GET("/devices/:device_id/profile", deviceProfileHandler.Get)
	authed.GET("/devices/:device_id/environment", deviceClassificationHandler.Get)
	authed.PATCH("/devices/:device_id/environment", deviceClassificationHandler.Update)
	authed.PATCH("/devices/:device_id/profile", deviceProfileHandler.Update)
	authed.POST("/devices/:device_id/profile/images", deviceProfileHandler.Upload)
	authed.PATCH("/devices/:device_id/profile/images/:image_id", deviceProfileHandler.UpdateImage)
	authed.PUT("/devices/:device_id/profile/images/order", deviceProfileHandler.Reorder)
	authed.DELETE("/devices/:device_id/profile/images/:image_id", deviceProfileHandler.DeleteImage)
	authed.GET("/data-streams", dataStreamHandler.List)
	authed.GET("/data-streams/:data_stream_id/telemetry", telemetryHandler.QueryDataStream)
	authed.GET("/data-streams/:data_stream_id/media", mediaHandler.ListDataStream)
	authed.GET("/data-streams/:data_stream_id", dataStreamHandler.Get)
	authed.GET("/datasets", datasetHandler.List)
	authed.POST("/datasets", datasetHandler.Create)
	authed.GET("/datasets/:dataset_id", datasetHandler.Get)
	authed.GET("/datasets/:dataset_id/telemetry", datasetHandler.QueryTelemetry)
	authed.GET("/processing/processors", processingHandler.Processors)
	authed.GET("/workspaces/:workspace_id/processing-tasks", processingHandler.List)
	authed.POST("/workspaces/:workspace_id/processing-tasks", processingHandler.Create)
	authed.GET("/workspaces/:workspace_id/processing-tasks/:task_id", processingHandler.Get)
	authed.PATCH("/workspaces/:workspace_id/processing-tasks/:task_id/status", processingHandler.SetStatus)
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
