package device

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

type NodeLocationInput struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
}

func (h *Handler) NodeLocation(c *gin.Context)      { h.nodeLocation(c, false) }
func (h *Handler) AdminNodeLocation(c *gin.Context) { h.nodeLocation(c, true) }
func (h *Handler) nodeLocation(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !admin && !h.authorize(c, "device", id, deviceConfigureAction) {
		return
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return
	}
	index, err := strconv.Atoi(c.Param("node_index"))
	var req NodeLocationInput
	var raw map[string]json.RawMessage
	bindErr := c.ShouldBindJSON(&raw)
	encoded, _ := json.Marshal(raw)
	decodeErr := json.Unmarshal(encoded, &req)
	if err != nil || index < 1 || bindErr != nil || decodeErr != nil || raw["latitude"] == nil || raw["longitude"] == nil || !validNodeLocation(req.Latitude, req.Longitude) {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "latitude and longitude must be a valid pair or both null"))
		return
	}
	entry := audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: "device.node.location", ResourceType: "device", ResourceID: &id, Result: audit.ResultSuccess})
	if !admin {
		scope, e := h.service.queries.GetWorkspaceDeviceContext(c.Request.Context(), actor.UserID, id)
		if e != nil {
			httpx.WriteAppError(c, e)
			return
		}
		entry.WorkspaceID = &scope.WorkspaceID
	}
	if err := h.service.UpdateNodeLocation(c.Request.Context(), id, index, req, entry); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, req)
}

// Coordinates belong to platform node metadata, never the source configuration.
func (s *Service) UpdateNodeLocation(ctx context.Context, id uuid.UUID, index int, req NodeLocationInput, entry audit.RecordInput) error {
	if index < 1 || !validNodeLocation(req.Latitude, req.Longitude) {
		return apperr.New(apperr.KindInvalidArgument, "invalid node coordinates")
	}
	asset, err := s.GetAsset(ctx, id)
	if err != nil {
		return err
	}
	if asset.SourceFamily != "lorawan_v2" || asset.DeviceType != "gateway" || int64(index) > asset.ChildCount {
		return apperr.New(apperr.KindInvalidArgument, "invalid LoRaWAN V2 node")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	actorID := entry.ActorID
	if entry.ActorType == audit.ActorSystemAdmin {
		actorID = entry.ActorAdminID
	}
	_, err = tx.Exec(ctx, `INSERT INTO node_profiles(device_id,node_index,latitude,longitude,updated_by,updated_by_type) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(device_id,node_index) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,updated_by=excluded.updated_by,updated_by_type=excluded.updated_by_type,updated_at=now()`, id, index, req.Latitude, req.Longitude, actorID, entry.ActorType)
	if err == nil {
		reason, _ := json.Marshal(map[string]any{"node_index": index, "latitude": req.Latitude, "longitude": req.Longitude})
		_, err = tx.Exec(ctx, `INSERT INTO audit_logs(workspace_id,actor_type,actor_id,actor_admin_id,action,resource_type,resource_id,result,reason,ip,user_agent,request_id) VALUES($1,$2,$3,$4,'device.node.location','device',$5,'success',$6,NULLIF($7,'')::inet,$8,$9)`, entry.WorkspaceID, entry.ActorType, entry.ActorID, entry.ActorAdminID, id, string(reason), entry.IP, entry.UserAgent, entry.RequestID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	return err
}
func validNodeLocation(lat, lon *float64) bool {
	if lat == nil || lon == nil {
		return lat == nil && lon == nil
	}
	return !math.IsNaN(*lat) && !math.IsNaN(*lon) && *lat >= -90 && *lat <= 90 && *lon >= -180 && *lon <= 180
}
