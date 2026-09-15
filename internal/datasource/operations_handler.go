package datasource

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
)

func (h *Handler) AdminSourceOperation(c *gin.Context) {
	id, ok := parseUUIDParam(c, "operation_id")
	if !ok {
		return
	}
	op, err := h.service.GetSourceOperation(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, op)
}
func (h *Handler) AdminSourceOperations(c *gin.Context) {
	id, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	items, err := h.service.ListSourceOperations(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) ReconcileDeviceConfig(c *gin.Context)      { h.reconcileDeviceConfig(c, false) }
func (h *Handler) AdminReconcileDeviceConfig(c *gin.Context) { h.reconcileDeviceConfig(c, true) }
func (h *Handler) reconcileDeviceConfig(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	if !admin && !h.authorize(c, "device", id, bindingManageAction) {
		return
	}
	result, err := h.service.ReconcileDeviceConfig(c.Request.Context(), id, actor.UserID)
	status := audit.ResultSuccess
	if err != nil {
		status = audit.ResultFailure
	}
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: "device.config.reconcile", ResourceType: "device", ResourceID: audit.ResourceID(id), Result: status}) {
		return
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminStartSourceSync(c *gin.Context) {
	id, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	result, err := h.service.StartSourceSync(c.Request.Context(), id, actor.UserID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: "data_source.sync.enqueue", ResourceType: "data_source", ResourceID: audit.ResourceID(id), Result: audit.ResultSuccess}) {
		return
	}
	c.JSON(http.StatusAccepted, result)
}
