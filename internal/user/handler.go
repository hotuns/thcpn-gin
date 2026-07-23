package user

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	service *Service
	audit   *audit.Service
}

type registerRequest struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email"`
}

func NewHandler(service *Service, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, audit: auditService}
}

func (h *Handler) Register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.Register(c.Request.Context(), RegisterInput{
		Name:  req.Name,
		Phone: req.Phone,
		Email: req.Email,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) Me(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": actor,
	})
}

type updateProfileRequest struct {
	Name string `json:"name"`
}

func (h *Handler) UpdateMe(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}
	var req updateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	updated, err := h.service.UpdateProfile(c.Request.Context(), UpdateProfileInput{UserID: actor.UserID, Name: req.Name})
	if err != nil {
		if !h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: "user.profile.update", ResourceType: "user", ResourceID: audit.ResourceID(actor.UserID), Result: audit.ResultFailure, Reason: apperr.MessageOf(err)}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: "user.profile.update", ResourceType: "user", ResourceID: audit.ResourceID(actor.UserID), Result: audit.ResultSuccess}) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": updated})
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
