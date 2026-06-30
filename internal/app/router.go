package app

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/user"
	"thcpn-gin/internal/workspace"
)

type Dependencies struct {
	Logger   *slog.Logger
	Postgres *pgxpool.Pool
	Redis    *redis.Client
}

type statusResponse struct {
	Status string `json:"status"`
}

func NewRouter(deps Dependencies) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(httpx.RequestID())
	router.Use(httpx.AccessLog(deps.Logger))

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, statusResponse{Status: "ok"})
	})
	router.GET("/readyz", readyHandler(deps))

	if deps.Postgres != nil {
		registerAPIV1(router, deps)
	}

	return router
}

func registerAPIV1(router *gin.Engine, deps Dependencies) {
	userService := user.NewService(deps.Postgres)
	workspaceService := workspace.NewService(deps.Postgres)

	userHandler := user.NewHandler(userService)
	workspaceHandler := workspace.NewHandler(workspaceService)
	authMiddleware := auth.Middleware(userService)

	api := router.Group("/api/v1")
	api.POST("/auth/register", userHandler.Register)

	authed := api.Group("")
	authed.Use(authMiddleware)
	authed.GET("/me", userHandler.Me)
	authed.GET("/workspaces", workspaceHandler.List)
	authed.POST("/workspaces", workspaceHandler.Create)
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
