package publicdevice

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/media"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/telemetry"
)

const publicCookie = "thcpn_public_access"

type Handler struct {
	service        *Service
	telemetry      *telemetry.Service
	media          *media.Service
	checker        *permission.Checker
	audit          *audit.Service
	sessions       *sessionManager
	limiter        *limiter
	cacheMu        sync.Mutex
	telemetryCache map[string]cachedTelemetry
	imageCache     map[string]cachedImages
}

type cachedTelemetry struct {
	value   telemetry.QueryResult
	expires time.Time
}

type cachedImages struct {
	value   media.ListResult
	expires time.Time
}

type updateRequest struct {
	Enabled         bool   `json:"enabled"`
	PasswordEnabled bool   `json:"password_enabled"`
	Password        string `json:"password"`
}

func NewHandler(service *Service, telemetryService *telemetry.Service, mediaService *media.Service, checker *permission.Checker, auditService *audit.Service, redisClient *redis.Client, secret string) *Handler {
	return &Handler{service: service, telemetry: telemetryService, media: mediaService, checker: checker, audit: auditService, sessions: newSessionManager(secret), limiter: newLimiter(redisClient), telemetryCache: make(map[string]cachedTelemetry), imageCache: make(map[string]cachedImages)}
}

func (h *Handler) GetManagement(c *gin.Context) {
	deviceID, ok := parseDeviceID(c)
	if !ok || !h.authorize(c, deviceID) {
		return
	}
	result, err := h.service.GetByDevice(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) UpdateManagement(c *gin.Context) {
	deviceID, ok := parseDeviceID(c)
	if !ok || !h.authorize(c, deviceID) {
		return
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.Update(c.Request.Context(), UpdateInput{DeviceID: deviceID, ActorID: actor.UserID, Enabled: req.Enabled, PasswordEnable: req.PasswordEnabled, Password: req.Password})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if h.audit != nil {
		reason := "公开=" + strconv.FormatBool(result.Enabled) + ", 密码保护=" + strconv.FormatBool(result.PasswordEnabled)
		_, err = h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{WorkspaceID: audit.WorkspaceID(result.WorkspaceID), ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: "device.public_access.update", ResourceType: "device", ResourceID: audit.ResourceID(deviceID), Result: audit.ResultSuccess, Reason: reason}))
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) GetPublic(c *gin.Context) {
	publication, device, ok := h.resolvePublic(c)
	if !ok {
		return
	}
	if publication.PasswordEnabled && !h.hasSession(c, publication) {
		c.JSON(http.StatusOK, PublicDevice{PublicSlug: publication.PublicSlug, PasswordNeeded: true, AccessGranted: false})
		return
	}
	telemetryStreams, imageStreams, err := h.service.LoadStreams(c.Request.Context(), publication.DeviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	device.AccessGranted = true
	device.Telemetry = telemetryStreams
	device.Images = imageStreams
	c.JSON(http.StatusOK, device)
}

func (h *Handler) Unlock(c *gin.Context) {
	publication, _, ok := h.resolvePublic(c)
	if !ok {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !publication.PasswordEnabled || !h.service.CheckPassword(publication, req.Password) {
		if !h.limiter.allow(c.Request.Context(), passwordLimitKey(publication.PublicSlug, c.ClientIP()), 5, 15*time.Minute) {
			httpx.WriteAppError(c, apperr.New(apperr.KindRateLimited, "too many password attempts"))
			return
		}
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "invalid public access password"))
		return
	}
	token, expiresAt, err := h.sessions.create(publication)
	if err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "create public access session", err))
		return
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: publicCookie, Value: token, Path: "/api/v1/public/devices/" + publication.PublicSlug, Expires: expiresAt, MaxAge: int(sessionTTL.Seconds()), HttpOnly: true, Secure: c.Request.TLS != nil, SameSite: http.SameSiteLaxMode})
	c.Status(http.StatusNoContent)
}

func (h *Handler) Telemetry(c *gin.Context) {
	publication, _, ok := h.resolveAuthorized(c)
	if !ok {
		return
	}
	start, end := Window(time.Now())
	cacheKey := publication.PublicSlug + ":" + strconv.Itoa(publication.AccessVersion)
	if value, cached := h.getTelemetryCache(cacheKey); cached {
		c.JSON(http.StatusOK, value)
		return
	}
	result, err := h.telemetry.Query(c.Request.Context(), telemetry.QueryInput{DeviceID: &publication.DeviceID, StartTime: start, EndTime: end, Limit: 5000, Adaptive: true, TargetPoints: 600})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.cacheMu.Lock()
	h.telemetryCache[cacheKey] = cachedTelemetry{value: result, expires: time.Now().Add(time.Minute)}
	h.cacheMu.Unlock()
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Images(c *gin.Context) {
	publication, _, ok := h.resolveAuthorized(c)
	if !ok {
		return
	}
	streamID, err := uuid.Parse(strings.TrimSpace(c.Query("data_stream_id")))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "data_stream_id is required"))
		return
	}
	_, imageStreams, err := h.service.LoadStreams(c.Request.Context(), publication.DeviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	found := false
	for _, stream := range imageStreams {
		if stream.ID == streamID {
			found = true
			break
		}
	}
	if !found {
		httpx.WriteAppError(c, apperr.New(apperr.KindNotFound, "image stream not found"))
		return
	}
	page := optionalPositiveInt(c.Query("page"), 1)
	pageSize := optionalPositiveInt(c.Query("page_size"), 24)
	if pageSize > 100 {
		pageSize = 100
	}
	cacheKey := publication.PublicSlug + ":" + strconv.Itoa(publication.AccessVersion) + ":" + streamID.String() + ":" + strconv.Itoa(page) + ":" + strconv.Itoa(pageSize)
	if value, cached := h.getImageCache(cacheKey); cached {
		c.JSON(http.StatusOK, value)
		return
	}
	start, end := Window(time.Now())
	result, err := h.media.List(c.Request.Context(), media.QueryInput{DataStreamID: &streamID, StartTime: start, EndTime: end, Page: page, PageSize: pageSize})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.cacheMu.Lock()
	h.imageCache[cacheKey] = cachedImages{value: result, expires: time.Now().Add(time.Minute)}
	h.cacheMu.Unlock()
	c.JSON(http.StatusOK, result)
}

func (h *Handler) getTelemetryCache(key string) (telemetry.QueryResult, bool) {
	h.cacheMu.Lock()
	defer h.cacheMu.Unlock()
	value, ok := h.telemetryCache[key]
	if !ok || value.expires.Before(time.Now()) {
		delete(h.telemetryCache, key)
		return telemetry.QueryResult{}, false
	}
	return value.value, true
}

func (h *Handler) getImageCache(key string) (media.ListResult, bool) {
	h.cacheMu.Lock()
	defer h.cacheMu.Unlock()
	value, ok := h.imageCache[key]
	if !ok || value.expires.Before(time.Now()) {
		delete(h.imageCache, key)
		return media.ListResult{}, false
	}
	return value.value, true
}

func (h *Handler) resolveAuthorized(c *gin.Context) (Publication, PublicDevice, bool) {
	publication, device, ok := h.resolvePublic(c)
	if !ok {
		return Publication{}, PublicDevice{}, false
	}
	if publication.PasswordEnabled && !h.hasSession(c, publication) {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "public access password is required"))
		return Publication{}, PublicDevice{}, false
	}
	return publication, device, true
}

func (h *Handler) resolvePublic(c *gin.Context) (Publication, PublicDevice, bool) {
	slug := strings.TrimSpace(c.Param("public_slug"))
	bucket, maximum := publicRequestLimit(c.FullPath())
	if slug == "" || !h.limiter.allow(c.Request.Context(), requestLimitKey(slug, c.ClientIP(), bucket), maximum, time.Minute) {
		httpx.WriteAppError(c, apperr.New(apperr.KindRateLimited, "public device request limit exceeded"))
		return Publication{}, PublicDevice{}, false
	}
	publication, device, err := h.service.Resolve(c.Request.Context(), slug)
	if err != nil {
		httpx.WriteAppError(c, err)
		return Publication{}, PublicDevice{}, false
	}
	return publication, device, true
}

func publicRequestLimit(route string) (string, int64) {
	switch route {
	case "/api/v1/public/devices/:public_slug/telemetry":
		return "telemetry", 60
	case "/api/v1/public/devices/:public_slug/images":
		return "images", 240
	case "/api/v1/public/devices/:public_slug/unlock":
		return "unlock", 60
	default:
		return "metadata", 120
	}
}

func (h *Handler) hasSession(c *gin.Context, publication Publication) bool {
	value, err := c.Cookie(publicCookie)
	return err == nil && h.sessions.valid(value, publication)
}

func (h *Handler) authorize(c *gin.Context, deviceID uuid.UUID) bool {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, "device.configure", permission.ResourceRef{Type: "device", ID: deviceID})
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return false
	}
	return true
}

func parseDeviceID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return uuid.Nil, false
	}
	return id, true
}

func optionalPositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}
