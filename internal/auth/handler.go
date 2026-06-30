package auth

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

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

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type logoutRequest struct {
	RefreshToken string `json:"refresh_token"`
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
		Phone:   req.Phone,
		Code:    req.Code,
		Name:    req.Name,
		Request: requestInfo(c),
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
		Request:  requestInfo(c),
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
		Request:    requestInfo(c),
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

func (h *Handler) Refresh(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.Refresh(c.Request.Context(), RefreshInput{
		RefreshToken: req.RefreshToken,
		Request:      requestInfo(c),
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorAnonymous,
			Action:       "auth.refresh",
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
		Action:       "auth.refresh",
		ResourceType: "auth",
		ResourceID:   audit.ResourceID(userID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) Logout(c *gin.Context) {
	var req logoutRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
			return
		}
	}
	actor, ok := ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}
	accessToken := ""
	if authHeader := c.GetHeader("Authorization"); authHeader != "" {
		var err error
		accessToken, err = BearerTokenFromHeader(authHeader)
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
	}
	if err := h.service.Logout(c.Request.Context(), LogoutInput{
		AccessToken:  accessToken,
		RefreshToken: req.RefreshToken,
		UserID:       actor.UserID,
	}); err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "auth.logout",
			ResourceType: "auth",
			ResourceID:   audit.ResourceID(actor.UserID),
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
		Action:       "auth.logout",
		ResourceType: "auth",
		ResourceID:   audit.ResourceID(actor.UserID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ListSessions(c *gin.Context) {
	actor, ok := ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}
	items, err := h.service.ListSessions(c.Request.Context(), ListSessionsInput{UserID: actor.UserID})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) RevokeSession(c *gin.Context) {
	actor, ok := ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}
	sessionID, err := uuid.Parse(c.Param("session_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid session_id"))
		return
	}
	if err := h.service.RevokeSession(c.Request.Context(), RevokeSessionInput{
		UserID:    actor.UserID,
		SessionID: sessionID,
	}); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "auth.session_revoke",
		ResourceType: "auth_session",
		ResourceID:   audit.ResourceID(sessionID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.Status(http.StatusNoContent)
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

func requestInfo(c *gin.Context) RequestInfo {
	return RequestInfo{
		UserAgent: c.Request.UserAgent(),
		ClientIP:  c.ClientIP(),
	}
}
