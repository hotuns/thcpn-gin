package deviceprofile

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

func (h *Handler) Installation(c *gin.Context) {
	id, actor, ok := h.authorize(c, "device.view")
	if !ok {
		return
	}
	result, err := h.service.Installation(c.Request.Context(), id, actor.IsSystemAdmin)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) SaveInstallation(c *gin.Context) {
	id, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	if !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "administrator required"))
		return
	}
	var input InstallationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid installation record"))
		return
	}
	result, err := h.service.SaveInstallation(c.Request.Context(), id, actor.UserID, input)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, id, "device.installation.update", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) UpdateDelivery(c *gin.Context) {
	id, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	if !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "administrator required"))
		return
	}
	var input DeliveryUpdateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid delivery information"))
		return
	}
	result, err := h.service.UpdateDelivery(c.Request.Context(), id, actor.UserID, input)
	if err != nil {
		if h.record(c, actor.UserID, id, "device.installation.delivery.update", audit.ResultFailure, "") {
			httpx.WriteAppError(c, err)
		}
		return
	}
	if result.Updated && !h.record(c, actor.UserID, id, "device.installation.delivery.update", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Tags(c *gin.Context) {
	id, actor, ok := h.authorize(c, "device.view")
	if !ok {
		return
	}
	if actor.IsSystemAdmin || actor.IsDemo {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "workspace user required"))
		return
	}
	workspace, err := uuid.Parse(c.Query("workspace_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "workspace_id required"))
		return
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, "workspace.view", permission.ResourceRef{Type: "workspace", ID: workspace})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "workspace access required"))
		return
	}
	var tags []string
	if c.Request.Method == http.MethodPut {
		// Device configuration permission remains required for user-edited metadata.
		if _, _, allowed := h.authorize(c, "device.configure"); !allowed {
			return
		}
		var input struct {
			Tags []string `json:"tags"`
		}
		if err = c.ShouldBindJSON(&input); err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid tags"))
			return
		}
		tags, err = h.service.SaveWorkspaceTags(c.Request.Context(), id, workspace, actor.UserID, input.Tags)
	} else {
		tags, err = h.service.WorkspaceTags(c.Request.Context(), id, workspace)
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if c.Request.Method == http.MethodPut && !h.record(c, actor.UserID, id, "device.tags.update", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, gin.H{"tags": tags})
}
