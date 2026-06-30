package auth

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	service *Service
	audit   *audit.Service
}

type sendSMSRequest struct {
	Phone string `json:"phone"`
}

type smsLoginRequest struct {
	Phone string `json:"phone"`
	Code  string `json:"code"`
	Name  string `json:"name"`
}

type passwordRegisterRequest struct {
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type passwordLoginRequest struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

func NewHandler(service *Service, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, audit: auditService}
}

func (h *Handler) SendSMS(c *gin.Context) {
	var req sendSMSRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.SendSMS(c.Request.Context(), SendSMSInput{Phone: req.Phone})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) LoginWithSMS(c *gin.Context) {
	var req smsLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.LoginWithSMS(c.Request.Context(), SMSLoginInput{
		Phone: req.Phone,
		Code:  req.Code,
		Name:  req.Name,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorAnonymous,
			Action:       "auth.sms_login",
			ResourceType: "auth",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	userID := result.User.ID
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(userID),
		Action:       "auth.sms_login",
		ResourceType: "auth",
		ResourceID:   audit.ResourceID(userID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) RegisterWithPassword(c *gin.Context) {
	var req passwordRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.RegisterWithPassword(c.Request.Context(), PasswordRegisterInput{
		Name:     req.Name,
		Phone:    req.Phone,
		Email:    req.Email,
		Password: req.Password,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorAnonymous,
			Action:       "auth.password_register",
			ResourceType: "auth",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	userID := result.User.ID
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(userID),
		Action:       "auth.password_register",
		ResourceType: "auth",
		ResourceID:   audit.ResourceID(userID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) LoginWithPassword(c *gin.Context) {
	var req passwordLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.LoginWithPassword(c.Request.Context(), PasswordLoginInput{
		Identifier: req.Identifier,
		Password:   req.Password,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorAnonymous,
			Action:       "auth.password_login",
			ResourceType: "auth",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	userID := result.User.ID
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(userID),
		Action:       "auth.password_login",
		ResourceType: "auth",
		ResourceID:   audit.ResourceID(userID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
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
