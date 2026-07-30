package datasource

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/permission"
)

const (
	dataSourceManageAction = "workspace.manage"
	bindingManageAction    = "device.configure"
)

type Handler struct {
	service      *Service
	checker      *permission.Checker
	audit        *audit.Service
	logSigner    *objectstore.Signer
	claimEnsurer interface {
		EnsureEligible(context.Context) (int64, error)
	}
}

type createDataSourceRequest struct {
	WorkspaceID  string `json:"workspace_id"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	DsnSecretRef string `json:"dsn_secret_ref"`
}

type updateDataSourceRequest struct {
	Name         *string `json:"name"`
	Type         *string `json:"type"`
	DsnSecretRef *string `json:"dsn_secret_ref"`
	Status       *string `json:"status"`
}

type sensorTemplateRequest struct {
	SensorType  string         `json:"sensor_type"`
	Description string         `json:"description"`
	Port        string         `json:"port"`
	PortNum     int64          `json:"port_num"`
	Driver      string         `json:"driver"`
	PortNums    []int          `json:"port_nums"`
	Params      map[string]any `json:"params"`
	Status      string         `json:"status"`
}

type importSensorTemplatesRequest struct {
	DataSourceID string `json:"data_source_id"`
}

type createBindingRequest struct {
	DataStreamID      string          `json:"data_stream_id"`
	DataSourceID      string          `json:"data_source_id"`
	AdapterCode       string          `json:"adapter_code"`
	DatabaseName      string          `json:"database_name"`
	SchemaName        string          `json:"schema_name"`
	TableName         string          `json:"table_name"`
	DeviceKeyField    string          `json:"device_key_field"`
	DeviceKeyValue    string          `json:"device_key_value"`
	TimeField         string          `json:"time_field"`
	ValueField        string          `json:"value_field"`
	PayloadType       string          `json:"payload_type"`
	AdapterConfigJSON json.RawMessage `json:"adapter_config"`
	QueryConfigJSON   json.RawMessage `json:"query_config"`
}

type updateBindingRequest struct {
	DataSourceID      *string          `json:"data_source_id"`
	AdapterCode       *string          `json:"adapter_code"`
	DatabaseName      *string          `json:"database_name"`
	SchemaName        *string          `json:"schema_name"`
	TableName         *string          `json:"table_name"`
	DeviceKeyField    *string          `json:"device_key_field"`
	DeviceKeyValue    *string          `json:"device_key_value"`
	TimeField         *string          `json:"time_field"`
	ValueField        *string          `json:"value_field"`
	PayloadType       *string          `json:"payload_type"`
	AdapterConfigJSON *json.RawMessage `json:"adapter_config"`
	QueryConfigJSON   *json.RawMessage `json:"query_config"`
	Status            *string          `json:"status"`
}

type syncTHCPNStandardStationRequest struct {
	ExternalDeviceID int64 `json:"external_device_id"`
}

type syncTHCPNGatewayRequest struct {
	ExternalGatewayID int64 `json:"external_gateway_id"`
}

type syncTHCPNCameraRequest struct {
	ExternalCameraID int64 `json:"external_camera_id"`
}

type updateTHCPNDeviceConfigRequest struct {
	DataJSON         json.RawMessage `json:"data_json"`
	ImageJSON        json.RawMessage `json:"image_json"`
	ControlJSON      json.RawMessage `json:"control_json"`
	ExpectedConfigID int64           `json:"expected_config_id" binding:"required,min=1"`
}

type updateSamplingProfileRequest struct {
	Mode             string `json:"mode"`
	DataMinutes      []int  `json:"data_minutes"`
	ImageMinute      *int   `json:"image_minute"`
	ImageHours       []int  `json:"image_hours"`
	ExpectedConfigID int64  `json:"expected_config_id"`
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) SetTHCPNLogSigner(signer *objectstore.Signer) {
	h.logSigner = signer
}

func (h *Handler) SetClaimCredentialEnsurer(ensurer interface {
	EnsureEligible(context.Context) (int64, error)
}) {
	h.claimEnsurer = ensurer
}

func (h *Handler) ensureClaimCredentials(ctx context.Context) error {
	if h.claimEnsurer == nil {
		return nil
	}
	_, err := h.claimEnsurer.EnsureEligible(ctx)
	return err
}

func (h *Handler) LatestTHCPNDeviceAttributes(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok || !h.authorize(c, "device", deviceID, "device.view") {
		return
	}
	result, err := h.service.LatestTHCPNDeviceAttributes(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) THCPNDeviceRuntime(c *gin.Context) {
	deviceIDs, ok := parseDeviceIDs(c)
	if !ok {
		return
	}
	for _, deviceID := range deviceIDs {
		if !h.authorize(c, "device", deviceID, "device.view") {
			return
		}
	}
	result, err := h.service.THCPNDeviceRuntime(c.Request.Context(), deviceIDs)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminTHCPNDeviceRuntime(c *gin.Context) {
	deviceIDs, ok := parseDeviceIDs(c)
	if !ok {
		return
	}
	result, err := h.service.THCPNDeviceRuntime(c.Request.Context(), deviceIDs)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) GetSamplingProfile(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok || !h.authorize(c, "device", deviceID, "device.view") {
		return
	}
	result, err := h.service.GetSamplingProfile(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	if h.checker != nil {
		decision, checkErr := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, bindingManageAction, permission.ResourceRef{Type: "device", ID: deviceID})
		if checkErr != nil {
			httpx.WriteAppError(c, checkErr)
			return
		}
		result.CanEdit = decision.Allowed
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) UpdateSamplingProfile(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok || !h.authorize(c, "device", deviceID, bindingManageAction) {
		return
	}
	var req updateSamplingProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	previous, _ := h.service.GetSamplingProfile(c.Request.Context(), deviceID)
	result, err := h.service.UpdateSamplingProfile(c.Request.Context(), SamplingProfileUpdateInput{
		DeviceID: deviceID, Mode: req.Mode, DataMinutes: req.DataMinutes, ImageMinute: req.ImageMinute,
		ImageHours: req.ImageHours, ExpectedConfigID: req.ExpectedConfigID, ActorUserID: actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID),
			Action: "device.sampling_profile.update", ResourceType: "device", ResourceID: audit.ResourceID(deviceID),
			Result: audit.ResultFailure, Reason: apperr.MessageOf(err)}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	reason := fmt.Sprintf("old=%s; new=%s; external_config_id=%d", previous.Summary, result.Summary, result.ExternalConfigID)
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID),
		Action: "device.sampling_profile.update", ResourceType: "device", ResourceID: audit.ResourceID(deviceID),
		Result: audit.ResultSuccess, Reason: reason}) {
		return
	}
	result.CanEdit = true
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminLatestTHCPNDeviceAttributes(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	result, err := h.service.LatestTHCPNDeviceAttributes(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if err := h.ensureClaimCredentials(c.Request.Context()); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminListTHCPNDeviceLogs(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	start, ok := parseOptionalLogDate(c, "start_date")
	if !ok {
		return
	}
	end, ok := parseOptionalLogDate(c, "end_date")
	if !ok {
		return
	}
	page, ok := parseOptionalIntQuery(c, "page")
	if !ok {
		return
	}
	pageSize, ok := parseOptionalIntQuery(c, "page_size")
	if !ok {
		return
	}
	result, err := h.service.ListTHCPNDeviceLogs(c.Request.Context(), THCPNDeviceLogListInput{
		DeviceID: deviceID,
		Start:    start,
		End:      end,
		Keyword:  c.Query("keyword"),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminPreviewTHCPNDeviceLog(c *gin.Context) {
	h.adminTHCPNDeviceLogAccess(c, "preview")
}

func (h *Handler) AdminDownloadTHCPNDeviceLog(c *gin.Context) {
	h.adminTHCPNDeviceLogAccess(c, "download")
}

func (h *Handler) adminTHCPNDeviceLogAccess(c *gin.Context, mode string) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	logItem, err := h.service.GetTHCPNDeviceLog(c.Request.Context(), deviceID, c.Param("log_uuid"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if h.logSigner == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "thcpn log object store is not configured"))
		return
	}
	key, err := h.logSigner.NormalizeObjectKey(logItem.Path)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	signed, err := h.logSigner.SignObjectURL(key, 15*time.Minute)
	if err != nil {
		_ = h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actorID(c)), Action: "thcpn.device_log." + mode, ResourceType: "device", ResourceID: audit.ResourceID(deviceID), Result: audit.ResultFailure, Reason: apperr.MessageOf(err)})
		httpx.WriteAppError(c, err)
		return
	}
	previewKind := logPreviewKind(logItem.Path)
	var content string
	if mode == "preview" && previewKind == "text" {
		content, err = fetchTextLogPreview(c.Request.Context(), signed.URL)
		if err != nil {
			_ = h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actorID(c)), Action: "thcpn.device_log." + mode, ResourceType: "device", ResourceID: audit.ResourceID(deviceID), Result: audit.ResultFailure, Reason: apperr.MessageOf(err)})
			httpx.WriteAppError(c, err)
			return
		}
	}
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actorID(c)), Action: "thcpn.device_log." + mode, ResourceType: "device", ResourceID: audit.ResourceID(deviceID), Result: audit.ResultSuccess, Reason: logItem.UUID}) {
		return
	}
	if mode == "download" {
		c.Redirect(http.StatusTemporaryRedirect, signed.URL)
		return
	}
	response := gin.H{"log": logItem, "preview_kind": previewKind, "url": signed.URL, "expires_at": signed.ExpiresAt}
	if previewKind == "text" {
		response["content"] = content
	}
	c.JSON(http.StatusOK, response)
}

const maxLogPreviewBytes = 2 << 20

func fetchTextLogPreview(ctx context.Context, rawURL string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "create log preview request", err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "fetch log preview", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", apperr.New(apperr.KindInternal, "log preview object is unavailable")
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxLogPreviewBytes+1))
	if err != nil {
		return "", apperr.Wrap(apperr.KindInternal, "read log preview", err)
	}
	if len(content) > maxLogPreviewBytes {
		return "", apperr.New(apperr.KindInvalidArgument, "log preview is larger than 2 MB")
	}
	if !utf8.Valid(content) {
		return "", apperr.New(apperr.KindInvalidArgument, "log preview is not a text file")
	}
	return string(content), nil
}

func logPreviewKind(value string) string {
	switch strings.ToLower(filepath.Ext(value)) {
	case ".log", ".txt", ".json", ".csv", ".xml", ".yaml", ".yml", ".md":
		return "text"
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
		return "image"
	case ".pdf":
		return "pdf"
	default:
		return "download"
	}
}

func parseOptionalLogDate(c *gin.Context, name string) (time.Time, bool) {
	value := strings.TrimSpace(c.Query(name))
	if value == "" {
		return time.Time{}, true
	}
	if parsed, err := time.Parse("2006-01-02", value); err == nil {
		return parsed, true
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed, true
	}
	httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
	return time.Time{}, false
}

func parseOptionalIntQuery(c *gin.Context, name string) (int, bool) {
	value := strings.TrimSpace(c.Query(name))
	if value == "" {
		return 0, true
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return 0, false
	}
	return parsed, true
}

func actorID(c *gin.Context) uuid.UUID {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return uuid.Nil
	}
	// System administrators have their own identity table. The audit schema's
	// actor_id currently references users, so do not write an admin UUID there.
	if actor.IsSystemAdmin {
		return uuid.Nil
	}
	return actor.UserID
}

func (h *Handler) ListDataSources(c *gin.Context) {
	httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "data sources are system managed"))
}

func (h *Handler) CreateDataSource(c *gin.Context) {
	httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "data sources are system managed"))
}

func (h *Handler) GetDataSource(c *gin.Context) {
	httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "data sources are system managed"))
}

func (h *Handler) UpdateDataSource(c *gin.Context) {
	httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "data sources are system managed"))
}

func (h *Handler) SyncTHCPNStandardStation(c *gin.Context) {
	httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "data sources are system managed"))
}

func (h *Handler) AdminListDataSources(c *gin.Context) {
	items, err := h.service.ListSystemDataSources(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) AdminCreateDataSource(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	var req createDataSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.CreateDataSource(c.Request.Context(), CreateDataSourceInput{
		Name:         req.Name,
		Type:         req.Type,
		DsnSecretRef: req.DsnSecretRef,
		ActorAdminID: actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) AdminUpdateDataSource(c *gin.Context) {
	dataSourceID, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}

	var req updateDataSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.UpdateDataSource(c.Request.Context(), UpdateDataSourceInput{
		DataSourceID: dataSourceID,
		Name:         req.Name,
		Type:         req.Type,
		DsnSecretRef: req.DsnSecretRef,
		Status:       req.Status,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminSyncTHCPNStandardStation(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	dataSourceID, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}

	var req syncTHCPNStandardStationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.SyncTHCPNStandardStation(c.Request.Context(), SyncTHCPNStandardStationInput{
		DataSourceID:     dataSourceID,
		ExternalDeviceID: req.ExternalDeviceID,
		ActorUserID:      actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminSyncAllTHCPNDevices(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	dataSourceID, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	// Accept an optional empty JSON object so clients can consistently submit
	// POST requests without inventing assignment or metadata fields.
	if c.Request.Body != nil {
		var body json.RawMessage
		if err := c.ShouldBindJSON(&body); err != nil && err != io.EOF {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
			return
		}
	}
	result, err := h.service.SyncAllTHCPNDevices(c.Request.Context(), SyncAllTHCPNDevicesInput{
		DataSourceID: dataSourceID,
		ActorUserID:  actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if err := h.ensureClaimCredentials(c.Request.Context()); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "thcpn.devices.full_sync",
		ResourceType: "data_source",
		ResourceID:   audit.ResourceID(dataSourceID),
		Result:       audit.ResultSuccess,
		Reason: fmt.Sprintf(
			"total=%d; synced=%d; created=%d; updated=%d; unconfigured=%d; failed=%d; relations=%d; topology_failed=%d; cameras=%d; cameras_failed=%d",
			result.Total, result.Synced, result.Created, result.Updated, result.Unconfigured,
			result.Failed, result.Relations, result.TopologyFailed, result.CamerasSynced, result.CamerasFailed,
		),
	}) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminSyncTHCPNCamera(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	dataSourceID, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	var req syncTHCPNCameraRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.SyncTHCPNCamera(c.Request.Context(), SyncTHCPNCameraInput{
		DataSourceID: dataSourceID, ExternalCameraID: req.ExternalCameraID, ActorUserID: actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID),
		Action: "thcpn.camera.sync", ResourceType: "device", ResourceID: audit.ResourceID(result.Device.ID),
		Result: audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminSyncTHCPNGateway(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	dataSourceID, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}

	var req syncTHCPNGatewayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.SyncTHCPNGateway(c.Request.Context(), SyncTHCPNGatewayInput{
		DataSourceID:      dataSourceID,
		ExternalGatewayID: req.ExternalGatewayID,
		ActorUserID:       actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "thcpn.gateway_topology.sync",
			ResourceType: "data_source",
			ResourceID:   audit.ResourceID(dataSourceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if err := h.ensureClaimCredentials(c.Request.Context()); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(uuidValue(result.Gateway.Device.WorkspaceID)),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "thcpn.gateway_topology.sync",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.Gateway.Device.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(uuidValue(result.Gateway.Device.WorkspaceID)),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device_relation.sync",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.Gateway.Device.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminGetTHCPNDeviceConfig(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	result, err := h.service.GetTHCPNDeviceConfig(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminListTHCPNSensorTemplates(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	page, ok := parseOptionalIntQuery(c, "page")
	if !ok {
		return
	}
	pageSize, ok := parseOptionalIntQuery(c, "page_size")
	if !ok {
		return
	}
	result, err := h.service.ListTHCPNSensorTemplates(c.Request.Context(), THCPNSensorTemplateListInput{
		DeviceID: deviceID, Search: c.Query("q"), Port: c.Query("port"), Driver: c.Query("driver"), Page: page, PageSize: pageSize,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminListSensorTemplates(c *gin.Context) {
	page, ok := parseOptionalIntQuery(c, "page")
	if !ok {
		return
	}
	pageSize, ok := parseOptionalIntQuery(c, "page_size")
	if !ok {
		return
	}
	result, err := h.service.ListTHCPNSensorTemplates(c.Request.Context(), THCPNSensorTemplateListInput{
		Search: c.Query("q"), Port: c.Query("port"), Driver: c.Query("driver"), Status: c.Query("status"), Page: page, PageSize: pageSize,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminCreateSensorTemplate(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	var req sensorTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.CreateTHCPNSensorTemplate(c.Request.Context(), sensorTemplateInput(req, actor.SystemAdministratorID()))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) AdminGetSensorTemplate(c *gin.Context) {
	id, ok := parseInt64Param(c, "template_id")
	if !ok {
		return
	}
	result, err := h.service.GetTHCPNSensorTemplate(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminUpdateSensorTemplate(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	id, ok := parseInt64Param(c, "template_id")
	if !ok {
		return
	}
	var req sensorTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.UpdateTHCPNSensorTemplate(c.Request.Context(), id, sensorTemplateInput(req, actor.SystemAdministratorID()))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminDeleteSensorTemplate(c *gin.Context) {
	id, ok := parseInt64Param(c, "template_id")
	if !ok {
		return
	}
	if err := h.service.DeleteTHCPNSensorTemplate(c.Request.Context(), id); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) AdminImportSensorTemplates(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	var req importSensorTemplatesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	dataSourceID, ok := parseUUIDValue(req.DataSourceID, "data_source_id", c)
	if !ok {
		return
	}
	result, err := h.service.ImportTHCPNSensorTemplates(c.Request.Context(), dataSourceID, actor.SystemAdministratorID())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func sensorTemplateInput(req sensorTemplateRequest, actorID uuid.UUID) THCPNSensorTemplateWriteInput {
	return THCPNSensorTemplateWriteInput{
		SensorType: req.SensorType, Description: req.Description, Port: req.Port, PortNum: req.PortNum,
		Driver: req.Driver, PortNums: req.PortNums, Params: req.Params, Status: req.Status, ActorID: actorID,
	}
}

func (h *Handler) AdminUpdateTHCPNDeviceConfig(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	var req updateTHCPNDeviceConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.UpdateTHCPNDeviceConfig(c.Request.Context(), UpdateTHCPNDeviceConfigInput{
		DeviceID: deviceID, DataJSON: req.DataJSON, ImageJSON: req.ImageJSON, ControlJSON: req.ControlJSON,
		ExpectedConfigID: req.ExpectedConfigID, ActorUserID: actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.config.update",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(deviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.config.update",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(deviceID),
		Result:       audit.ResultSuccess,
		Reason: fmt.Sprintf(
			"old_config_id=%d; new_config_id=%d; sections=%s; sensors=%d; metrics=%d; images=%d",
			result.Audit.PreviousConfigID,
			result.Config.ID,
			strings.Join(result.Audit.ChangedSections, ","),
			result.Audit.SensorCount,
			result.Audit.MetricCount,
			result.Audit.ImageCount,
		),
	}) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) ListBindings(c *gin.Context) {
	dataStreamID, ok := parseUUIDValue(c.Query("data_stream_id"), "data_stream_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "data_stream", dataStreamID, bindingManageAction) {
		return
	}

	items, err := h.service.ListDataStreamBindings(c.Request.Context(), dataStreamID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateBinding(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	var req createBindingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	dataStreamID, ok := parseUUIDValue(req.DataStreamID, "data_stream_id", c)
	if !ok {
		return
	}
	dataSourceID, ok := parseUUIDValue(req.DataSourceID, "data_source_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "data_stream", dataStreamID, bindingManageAction) {
		return
	}

	result, err := h.service.CreateDataStreamBinding(c.Request.Context(), CreateDataStreamBindingInput{
		DataStreamID:      dataStreamID,
		DataSourceID:      dataSourceID,
		AdapterCode:       req.AdapterCode,
		DatabaseName:      req.DatabaseName,
		SchemaName:        req.SchemaName,
		TableName:         req.TableName,
		DeviceKeyField:    req.DeviceKeyField,
		DeviceKeyValue:    req.DeviceKeyValue,
		TimeField:         req.TimeField,
		ValueField:        req.ValueField,
		PayloadType:       req.PayloadType,
		AdapterConfigJSON: createBindingAdapterConfig(req),
		ActorUserID:       actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) GetBinding(c *gin.Context) {
	bindingID, ok := parseUUIDParam(c, "binding_id")
	if !ok {
		return
	}

	result, err := h.service.GetDataStreamBinding(c.Request.Context(), bindingID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.authorize(c, "data_stream", result.DataStreamID, bindingManageAction) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) UpdateBinding(c *gin.Context) {
	bindingID, ok := parseUUIDParam(c, "binding_id")
	if !ok {
		return
	}

	current, err := h.service.GetDataStreamBinding(c.Request.Context(), bindingID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.authorize(c, "data_stream", current.DataStreamID, bindingManageAction) {
		return
	}

	var req updateBindingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	dataSourceID, ok := parseOptionalUUIDPointer(req.DataSourceID, "data_source_id", c)
	if !ok {
		return
	}
	result, err := h.service.UpdateDataStreamBinding(c.Request.Context(), UpdateDataStreamBindingInput{
		BindingID:         bindingID,
		DataSourceID:      dataSourceID,
		AdapterCode:       req.AdapterCode,
		DatabaseName:      req.DatabaseName,
		SchemaName:        req.SchemaName,
		TableName:         req.TableName,
		DeviceKeyField:    req.DeviceKeyField,
		DeviceKeyValue:    req.DeviceKeyValue,
		TimeField:         req.TimeField,
		ValueField:        req.ValueField,
		PayloadType:       req.PayloadType,
		AdapterConfigJSON: updateBindingAdapterConfig(req),
		Status:            req.Status,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func createBindingAdapterConfig(req createBindingRequest) json.RawMessage {
	if len(req.AdapterConfigJSON) > 0 {
		return req.AdapterConfigJSON
	}
	return req.QueryConfigJSON
}

func updateBindingAdapterConfig(req updateBindingRequest) *json.RawMessage {
	if req.AdapterConfigJSON != nil {
		return req.AdapterConfigJSON
	}
	return req.QueryConfigJSON
}

func (h *Handler) authorize(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) bool {
	actor, ok := actorFromContext(c)
	if !ok {
		return false
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return false
	}

	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{
		Type: resourceType,
		ID:   resourceID,
	})
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

func actorFromContext(c *gin.Context) (auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return auth.Actor{}, false
	}
	return actor, true
}

func parseDeviceIDs(c *gin.Context) ([]uuid.UUID, bool) {
	raw := strings.TrimSpace(c.Query("device_ids"))
	if raw == "" {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "device_ids is required"))
		return nil, false
	}
	parts := strings.Split(raw, ",")
	if len(parts) > maxTHCPNRuntimeDevices {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "at most 200 device ids are allowed"))
		return nil, false
	}
	result := make([]uuid.UUID, 0, len(parts))
	for _, part := range parts {
		id, err := uuid.Parse(strings.TrimSpace(part))
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "device_ids contains an invalid uuid"))
			return nil, false
		}
		result = append(result, id)
	}
	return uniqueUUIDs(result), true
}

func parseUUIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	return parseUUIDValue(c.Param(name), name, c)
}

func parseInt64Param(c *gin.Context, name string) (int64, bool) {
	value, err := strconv.ParseInt(strings.TrimSpace(c.Param(name)), 10, 64)
	if err != nil || value <= 0 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, name+" must be a positive integer"))
		return 0, false
	}
	return value, true
}

func parseUUIDValue(value string, name string, c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}

func parseOptionalUUIDValue(value string, name string, c *gin.Context) (*uuid.UUID, bool) {
	if value == "" {
		return nil, true
	}
	id, ok := parseUUIDValue(value, name, c)
	if !ok {
		return nil, false
	}
	return &id, true
}

func parseOptionalUUIDPointer(value *string, name string, c *gin.Context) (*uuid.UUID, bool) {
	if value == nil {
		return nil, true
	}
	return parseOptionalUUIDValue(*value, name, c)
}

func uuidValue(value *uuid.UUID) uuid.UUID {
	if value == nil {
		return uuid.Nil
	}
	return *value
}

func (h *Handler) record(c *gin.Context, input audit.RecordInput) bool {
	if h.audit == nil {
		return true
	}
	if _, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, input)); err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	return true
}
