package deviceclassification

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

type updateRequest struct {
	EcosystemID      *string  `json:"ecosystem_term_id"`
	ObservationIDs   []string `json:"observation_object_ids"`
	PurposeIDs       []string `json:"purpose_ids"`
	ManagementID     *string  `json:"management_term_id"`
	DeploymentID     *string  `json:"deployment_term_id"`
	AltitudeM        *float64 `json:"altitude_m"`
	CommissionedYear *int     `json:"commissioned_year"`
	ResearchTags     []string `json:"research_tags"`
	OverriddenFields []string `json:"overridden_fields"`
}

type termRequest struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Code      string  `json:"code"`
	NameZH    string  `json:"name_zh"`
	NameEN    string  `json:"name_en"`
	ParentID  *string `json:"parent_id"`
	Status    string  `json:"status"`
	SortOrder int     `json:"sort_order"`
}
type bulkRequest struct {
	DeviceIDs  []string      `json:"device_ids"`
	Attributes updateRequest `json:"attributes"`
}

func NewHandler(service *Service, checker *permission.Checker, auditService *audit.Service) *Handler {
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) Catalog(c *gin.Context) {
	items, err := h.service.Catalog(c.Request.Context(), false)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) AdminCatalog(c *gin.Context) {
	items, err := h.service.Catalog(c.Request.Context(), true)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Get(c *gin.Context) {
	id, actor, ok := h.authorize(c, "device.view")
	if !ok {
		return
	}
	_ = actor
	result, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) Update(c *gin.Context) {
	id, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	input, err := parseUpdate(id, actor.UserID, "user", req)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	result, err := h.service.Update(c.Request.Context(), input)
	if err != nil {
		h.record(c, audit.ActorUser, actor.UserID, id, "device.environment.update", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.ActorUser, actor.UserID, id, "device.environment.update", audit.ResultSuccess, strings.Join(req.OverriddenFields, ",")) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Map(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}
	workspaceID, err := uuid.Parse(c.Query("workspace_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid workspace_id"))
		return
	}
	result, err := h.service.Map(c.Request.Context(), &workspaceID, c.Query("include_children") == "true")
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	filtered := make([]MapItem, 0, len(result.Items))
	for _, item := range result.Items {
		decision, checkErr := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, "device.view", permission.ResourceRef{Type: "device", ID: item.DeviceID})
		if checkErr != nil {
			httpx.WriteAppError(c, checkErr)
			return
		}
		if decision.Allowed {
			filtered = append(filtered, item)
		}
	}
	result.Items = filtered
	recount(&result)
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminMap(c *gin.Context) {
	result, err := h.service.Map(c.Request.Context(), nil, c.Query("include_children") == "true")
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) AdminGet(c *gin.Context) {
	id, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return
	}
	result, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) AdminUpdate(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return
	}
	id, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return
	}
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	input, err := parseUpdate(id, actor.UserID, "system_admin", req)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	result, err := h.service.Update(c.Request.Context(), input)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, audit.ActorSystemAdmin, actor.UserID, id, "device.environment.update", audit.ResultSuccess, strings.Join(req.OverriddenFields, ","))
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminUpsertTerm(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return
	}
	var req termRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item := Term{Kind: req.Kind, Code: req.Code, NameZH: req.NameZH, NameEN: req.NameEN, Status: req.Status, SortOrder: req.SortOrder}
	if req.ID != "" {
		item.ID, _ = uuid.Parse(req.ID)
	}
	if req.ParentID != nil && *req.ParentID != "" {
		id, err := uuid.Parse(*req.ParentID)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid parent_id"))
			return
		}
		item.ParentID = &id
	}
	result, err := h.service.UpsertTerm(c.Request.Context(), item)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, audit.ActorSystemAdmin, actor.UserID, result.ID, "device.taxonomy.update", audit.ResultSuccess, result.Kind+":"+result.Code)
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminBulkUpdate(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return
	}
	var req bulkRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.DeviceIDs) == 0 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "device_ids are required"))
		return
	}
	updated := 0
	failures := []gin.H{}
	for _, raw := range req.DeviceIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			failures = append(failures, gin.H{"device_id": raw, "error": "invalid device id"})
			continue
		}
		input, parseErr := parseUpdate(id, actor.UserID, "system_admin", req.Attributes)
		if parseErr != nil {
			failures = append(failures, gin.H{"device_id": raw, "error": parseErr.Error()})
			continue
		}
		if _, err = h.service.Update(c.Request.Context(), input); err != nil {
			failures = append(failures, gin.H{"device_id": raw, "error": apperr.MessageOf(err)})
			continue
		}
		updated++
	}
	h.record(c, audit.ActorSystemAdmin, actor.UserID, uuid.Nil, "device.environment.bulk_update", audit.ResultSuccess, "updated devices")
	c.JSON(http.StatusOK, gin.H{"updated": updated, "failed": len(failures), "failures": failures})
}

func (h *Handler) GetSite(c *gin.Context) {
	id, _, ok := h.authorizeSite(c, "site.view")
	if !ok {
		return
	}
	result, err := h.service.GetSite(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) UpdateSite(c *gin.Context) {
	id, actor, ok := h.authorizeSite(c, "site.manage")
	if !ok {
		return
	}
	h.updateSite(c, id, actor.UserID, audit.ActorUser)
}

func (h *Handler) AdminGetSite(c *gin.Context) {
	id, err := uuid.Parse(c.Param("site_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid site_id"))
		return
	}
	result, err := h.service.GetSite(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminUpdateSite(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return
	}
	id, err := uuid.Parse(c.Param("site_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid site_id"))
		return
	}
	h.updateSite(c, id, actor.UserID, audit.ActorSystemAdmin)
}

func (h *Handler) updateSite(c *gin.Context, siteID, actorID uuid.UUID, actorType string) {
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	parsed, err := parseUpdate(uuid.Nil, actorID, actorType, req)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	result, err := h.service.UpdateSite(c.Request.Context(), UpdateSiteInput{SiteID: siteID, EcosystemID: parsed.EcosystemID, ObservationIDs: parsed.ObservationIDs, PurposeIDs: parsed.PurposeIDs, ManagementID: parsed.ManagementID, DeploymentID: parsed.DeploymentID, AltitudeM: parsed.AltitudeM, CommissionedYear: parsed.CommissionedYear, ResearchTags: parsed.ResearchTags, ActorID: actorID, ActorType: actorType})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.recordResource(c, actorType, actorID, siteID, "site", "site.environment.update", audit.ResultSuccess, "updated site defaults") {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) authorize(c *gin.Context, action string) (uuid.UUID, auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return uuid.Nil, auth.Actor{}, false
	}
	id, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return uuid.Nil, auth.Actor{}, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: "device", ID: id})
	if err != nil {
		httpx.WriteAppError(c, err)
		return uuid.Nil, auth.Actor{}, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return uuid.Nil, auth.Actor{}, false
	}
	return id, actor, true
}

func (h *Handler) authorizeSite(c *gin.Context, action string) (uuid.UUID, auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return uuid.Nil, auth.Actor{}, false
	}
	id, err := uuid.Parse(c.Param("site_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid site_id"))
		return uuid.Nil, auth.Actor{}, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: "site", ID: id})
	if err != nil {
		httpx.WriteAppError(c, err)
		return uuid.Nil, auth.Actor{}, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return uuid.Nil, auth.Actor{}, false
	}
	return id, actor, true
}
func parseUpdate(deviceID, actorID uuid.UUID, actorType string, req updateRequest) (UpdateInput, error) {
	if deviceID != uuid.Nil {
		if req.AltitudeM != nil {
			return UpdateInput{}, apperr.New(apperr.KindInvalidArgument, "device altitude is managed by its source")
		}
		for _, field := range req.OverriddenFields {
			if field == "altitude_m" {
				return UpdateInput{}, apperr.New(apperr.KindInvalidArgument, "device altitude cannot be overridden")
			}
		}
	}
	ecosystem, err := parseOptional(req.EcosystemID)
	if err != nil {
		return UpdateInput{}, err
	}
	management, err := parseOptional(req.ManagementID)
	if err != nil {
		return UpdateInput{}, err
	}
	deployment, err := parseOptional(req.DeploymentID)
	if err != nil {
		return UpdateInput{}, err
	}
	observations, err := parseIDs(req.ObservationIDs)
	if err != nil {
		return UpdateInput{}, err
	}
	purposes, err := parseIDs(req.PurposeIDs)
	if err != nil {
		return UpdateInput{}, err
	}
	return UpdateInput{DeviceID: deviceID, EcosystemID: ecosystem, ObservationIDs: observations, PurposeIDs: purposes, ManagementID: management, DeploymentID: deployment, AltitudeM: req.AltitudeM, CommissionedYear: req.CommissionedYear, ResearchTags: req.ResearchTags, OverriddenFields: req.OverriddenFields, ActorID: actorID, ActorType: actorType}, nil
}
func parseOptional(raw *string) (*uuid.UUID, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	id, err := uuid.Parse(*raw)
	if err != nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "invalid taxonomy id")
	}
	return &id, nil
}
func parseIDs(raw []string) ([]uuid.UUID, error) {
	out := make([]uuid.UUID, 0, len(raw))
	for _, value := range raw {
		id, err := uuid.Parse(value)
		if err != nil {
			return nil, apperr.New(apperr.KindInvalidArgument, "invalid taxonomy id")
		}
		out = append(out, id)
	}
	return out, nil
}
func recount(result *MapResult) {
	result.Total = len(result.Items)
	result.Located = 0
	result.Unlocated = 0
	result.Unclassified = 0
	for _, item := range result.Items {
		if item.Latitude != nil && item.Longitude != nil {
			result.Located++
		} else {
			result.Unlocated++
		}
		if item.Environment.Ecosystem == nil {
			result.Unclassified++
		}
	}
}
func (h *Handler) record(c *gin.Context, actorType string, actorID, resourceID uuid.UUID, action, result, reason string) bool {
	return h.recordResource(c, actorType, actorID, resourceID, "device", action, result, reason)
}
func (h *Handler) recordResource(c *gin.Context, actorType string, actorID, resourceID uuid.UUID, resourceType, action, result, reason string) bool {
	if h.audit == nil {
		return true
	}
	input := audit.RecordInput{ActorType: actorType, Action: action, ResourceType: resourceType, Result: result, Reason: reason}
	if actorType == audit.ActorSystemAdmin {
		input.ActorAdminID = &actorID
	} else {
		input.ActorID = &actorID
	}
	if resourceID != uuid.Nil {
		input.ResourceID = &resourceID
	}
	_, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, input))
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	return true
}
