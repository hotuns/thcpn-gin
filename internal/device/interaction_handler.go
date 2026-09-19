package device

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

type InteractionContext struct {
	Device  Device          `json:"device"`
	Actions map[string]bool `json:"actions"`
}

func (h *Handler) Interaction(c *gin.Context)      { h.interaction(c, false) }
func (h *Handler) AdminInteraction(c *gin.Context) { h.interaction(c, true) }

func (h *Handler) interaction(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !admin {
		if _, ok := h.authorizeDecision(c, "device", id, deviceViewAction); !ok {
			return
		}
	}
	item, err := h.service.GetAsset(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return
	}
	result := InteractionContext{Device: item, Actions: map[string]bool{}}
	for name, action := range map[string]string{"view": deviceViewAction, "configure": deviceConfigureAction, "telemetry": "telemetry.view_history", "logs": deviceConfigureAction, "source_configure": deviceConfigureAction} {
		allowed := admin
		if !admin {
			decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: "device", ID: id})
			if err != nil {
				httpx.WriteAppError(c, err)
				return
			}
			allowed = decision.Allowed
		}
		if name == "source_configure" && (item.Status != "active" || item.SourceStatus != "active") {
			allowed = false
		}
		result.Actions[name] = allowed
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Nodes(c *gin.Context)      { h.nodes(c, false) }
func (h *Handler) AdminNodes(c *gin.Context) { h.nodes(c, true) }

func (h *Handler) nodes(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !admin {
		if _, ok := h.authorizeDecision(c, "device", id, deviceViewAction); !ok {
			return
		}
	}
	items, err := h.service.ListGatewayNodes(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	visible := make([]GatewayNode, 0, len(items))
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return
	}
	renamePermissions := map[string]bool{}
	for _, item := range items {
		if !admin && item.Target.DeviceID != nil {
			decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, deviceViewAction, permission.ResourceRef{Type: "device", ID: *item.Target.DeviceID})
			if err != nil {
				httpx.WriteAppError(c, err)
				return
			}
			if !decision.Allowed {
				continue
			}
		}
		item.CanRename = admin
		if !admin {
			targetID := id
			if item.Target.DeviceID != nil {
				targetID = *item.Target.DeviceID
			}
			allowed, cached := renamePermissions[targetID.String()]
			if !cached {
				decision, e := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, deviceConfigureAction, permission.ResourceRef{Type: "device", ID: targetID})
				if e != nil {
					httpx.WriteAppError(c, e)
					return
				}
				allowed = decision.Allowed
				renamePermissions[targetID.String()] = allowed
			}
			item.CanRename = allowed
		}
		visible = append(visible, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": visible})
}
