package processing

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/billing"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

type Handler struct {
	service *Service
	checker *permission.Checker
	billing *billing.Service
	audit   *audit.Service
}

type createTaskRequest struct {
	Name             string          `json:"name"`
	Description      string          `json:"description"`
	TargetType       string          `json:"target_type"`
	TargetID         uuid.UUID       `json:"target_id"`
	ProcessorCode    string          `json:"processor_code"`
	ProcessorVersion string          `json:"processor_version"`
	Config           json.RawMessage `json:"config"`
	Trigger          json.RawMessage `json:"trigger"`
	StartAt          time.Time       `json:"start_at"`
	Inputs           []TaskInput     `json:"inputs"`
}

func NewHandler(service *Service, checker *permission.Checker, billingService *billing.Service, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, billing: billingService, audit: auditService}
}

func (h *Handler) Processors(c *gin.Context) {
	items, err := h.service.SyncCatalog(c.Request.Context())
	if err != nil {
		items, err = h.service.ListProcessors(c.Request.Context())
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) List(c *gin.Context) {
	workspaceID, _, ok := h.authorize(c, "processing.view")
	if !ok {
		return
	}
	items, err := h.service.ListTasks(c.Request.Context(), workspaceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Get(c *gin.Context) {
	workspaceID, _, ok := h.authorize(c, "processing.view")
	if !ok {
		return
	}
	taskID, ok := parseID(c.Param("task_id"), "task_id", c)
	if !ok {
		return
	}
	item, err := h.service.GetTask(c.Request.Context(), workspaceID, taskID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) Executions(c *gin.Context) {
	workspaceID, _, ok := h.authorize(c, "processing.view")
	if !ok {
		return
	}
	taskID, ok := parseID(c.Param("task_id"), "task_id", c)
	if !ok {
		return
	}
	items, err := h.service.ListExecutions(c.Request.Context(), workspaceID, taskID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Create(c *gin.Context) {
	workspaceID, actor, ok := h.authorize(c, "processing.manage")
	if !ok {
		return
	}
	if h.billing != nil {
		if err := h.billing.RequireProfessional(c.Request.Context(), workspaceID); err != nil {
			httpx.WriteAppError(c, err)
			return
		}
	}
	var req createTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item, err := h.service.CreateTask(c.Request.Context(), CreateInput{
		WorkspaceID: workspaceID, Name: req.Name, Description: req.Description, TargetType: req.TargetType,
		TargetID: req.TargetID, ProcessorCode: req.ProcessorCode, ProcessorVersion: req.ProcessorVersion,
		Config: req.Config, Trigger: req.Trigger, StartAt: req.StartAt, Inputs: req.Inputs, ActorID: actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) SetStatus(c *gin.Context) {
	workspaceID, _, ok := h.authorize(c, "processing.manage")
	if !ok {
		return
	}
	taskID, ok := parseID(c.Param("task_id"), "task_id", c)
	if !ok {
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	if req.Status == "active" && h.billing != nil {
		if err := h.billing.RequireProfessional(c.Request.Context(), workspaceID); err != nil {
			httpx.WriteAppError(c, err)
			return
		}
	}
	item, err := h.service.SetStatus(c.Request.Context(), workspaceID, taskID, req.Status)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) DownloadResult(c *gin.Context) {
	workspaceID, actor, ok := h.authorize(c, "processing.view")
	if !ok {
		return
	}
	resultID, ok := parseID(c.Param("result_id"), "result_id", c)
	if !ok {
		return
	}
	url, expiresAt, err := h.service.PrepareResultDownload(c.Request.Context(), workspaceID, resultID, actor.UserID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"result_id": resultID, "url": url, "expires_at": expiresAt})
}

func (h *Handler) authorize(c *gin.Context, action string) (uuid.UUID, auth.Actor, bool) {
	workspaceID, ok := parseID(c.Param("workspace_id"), "workspace_id", c)
	if !ok {
		return uuid.Nil, auth.Actor{}, false
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return uuid.Nil, auth.Actor{}, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: "workspace", ID: workspaceID})
	if err != nil {
		httpx.WriteAppError(c, err)
		return uuid.Nil, auth.Actor{}, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return uuid.Nil, auth.Actor{}, false
	}
	return workspaceID, actor, true
}

func parseID(value, name string, c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(value)
	if err != nil || id == uuid.Nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}
