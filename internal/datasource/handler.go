package datasource

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

const (
	dataSourceManageAction = "workspace.manage"
	bindingManageAction    = "device.configure"
)

type Handler struct {
	service *Service
	checker *permission.Checker
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

func NewHandler(service *Service, checker *permission.Checker) *Handler {
	return &Handler{service: service, checker: checker}
}

func (h *Handler) ListDataSources(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", workspaceID, dataSourceManageAction) {
		return
	}

	items, err := h.service.ListDataSources(c.Request.Context(), workspaceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateDataSource(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	var req createDataSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	workspaceID, ok := parseUUIDValue(req.WorkspaceID, "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", workspaceID, dataSourceManageAction) {
		return
	}

	result, err := h.service.CreateDataSource(c.Request.Context(), CreateDataSourceInput{
		WorkspaceID:  workspaceID,
		Name:         req.Name,
		Type:         req.Type,
		DsnSecretRef: req.DsnSecretRef,
		ActorUserID:  actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) GetDataSource(c *gin.Context) {
	dataSourceID, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}

	result, err := h.service.GetDataSource(c.Request.Context(), dataSourceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.authorize(c, "workspace", result.WorkspaceID, dataSourceManageAction) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) UpdateDataSource(c *gin.Context) {
	dataSourceID, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}

	current, err := h.service.GetDataSource(c.Request.Context(), dataSourceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.authorize(c, "workspace", current.WorkspaceID, dataSourceManageAction) {
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

func parseUUIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	return parseUUIDValue(c.Param(name), name, c)
}

func parseUUIDValue(value string, name string, c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}

func parseOptionalUUIDPointer(value *string, name string, c *gin.Context) (*uuid.UUID, bool) {
	if value == nil {
		return nil, true
	}
	id, ok := parseUUIDValue(*value, name, c)
	if !ok {
		return nil, false
	}
	return &id, true
}
