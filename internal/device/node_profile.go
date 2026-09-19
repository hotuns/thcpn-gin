package device

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/nodeprofile"
)

func (h *Handler) RenameNode(c *gin.Context)      { h.renameNode(c, false) }
func (h *Handler) AdminRenameNode(c *gin.Context) { h.renameNode(c, true) }
func (h *Handler) renameNode(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !admin && !h.authorize(c, "device", id, deviceConfigureAction) {
		return
	}
	index, err := strconv.Atoi(c.Param("node_index"))
	if err != nil || index < 1 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid node index"))
		return
	}
	var req struct {
		Name *string `json:"name"`
	}
	if c.ShouldBindJSON(&req) != nil || req.Name == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "name is required"))
		return
	}
	if name, ok := h.saveNodeName(c, id, index, *req.Name, admin); ok {
		c.JSON(http.StatusOK, gin.H{"node_index": index, "name": nodeprofile.Label(name, index), "custom_name": name})
	}
}

// Device-backed THCPN nodes keep using the existing device update endpoints.
func (h *Handler) updateNodeDeviceName(c *gin.Context, id uuid.UUID, req updateDeviceRequest, admin bool) bool {
	if req.Name == nil || req.ProjectIDSet || req.SiteIDSet || req.ProductID != nil || req.Status != nil || req.DeviceType != nil || req.Capabilities != nil {
		return false
	}
	asset, err := h.service.GetAsset(c.Request.Context(), id)
	if err != nil || asset.DeviceType != "gateway_node" {
		return false
	}
	if !admin && !h.authorize(c, "device", id, deviceConfigureAction) {
		return true
	}
	if _, ok := h.saveNodeName(c, id, 0, *req.Name, admin); ok {
		result, err := h.service.GetAsset(c.Request.Context(), id)
		if err != nil {
			httpx.WriteAppError(c, err)
		} else {
			c.JSON(http.StatusOK, result)
		}
	}
	return true
}

func (h *Handler) saveNodeName(c *gin.Context, id uuid.UUID, index int, name string, admin bool) (string, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		return "", false
	}
	entry := audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: "device.node.rename", ResourceType: "device", ResourceID: &id, Result: audit.ResultSuccess})
	if !admin {
		scope, err := h.service.queries.GetWorkspaceDeviceContext(c.Request.Context(), actor.UserID, id)
		if err != nil {
			httpx.WriteAppError(c, err)
			return "", false
		}
		entry.WorkspaceID = &scope.WorkspaceID
	}
	result, err := h.service.RenameNode(c.Request.Context(), id, index, name, entry)
	if err != nil {
		httpx.WriteAppError(c, err)
		return "", false
	}
	return result, true
}

// RenameNode writes only platform metadata. Index zero denotes an existing THCPN
// node device; positive indexes identify LoRa or carbon nodes, never devices.
func (s *Service) RenameNode(ctx context.Context, id uuid.UUID, index int, raw string, entry audit.RecordInput) (string, error) {
	name, err := nodeprofile.Normalize(raw)
	if err != nil {
		return "", err
	}
	asset, err := s.GetAsset(ctx, id)
	if err != nil {
		return "", err
	}
	if index < 0 || (index == 0 && (asset.DeviceType != "gateway_node" || name == "")) {
		return "", apperr.New(apperr.KindInvalidArgument, "node device requires a name")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var old string
	if err = tx.QueryRow(ctx, "SELECT name FROM devices WHERE id=$1 FOR UPDATE", id).Scan(&old); err != nil {
		return "", err
	}
	auditIndex := any(nil)
	if index == 0 {
		var externalIndex int64
		lookupErr := tx.QueryRow(ctx, "SELECT external_child_device_id FROM device_relations WHERE child_device_id=$1 AND relation_type='gateway_node' AND status='active' LIMIT 1", id).Scan(&externalIndex)
		if lookupErr == nil {
			auditIndex = externalIndex
		} else if !errors.Is(lookupErr, pgx.ErrNoRows) {
			return "", lookupErr
		}
		_, err = tx.Exec(ctx, "UPDATE devices SET name=$2,updated_at=now() WHERE id=$1", id, name)
	} else {
		key := "lorawan_v2_nodes_count"
		fallback := 0
		if asset.DeviceType == "carbon_sink" {
			key = "carbon_nodes_count"
			fallback = 1
		} else if asset.SourceFamily != "lorawan_v2" || asset.DeviceType != "gateway" {
			return "", apperr.New(apperr.KindInvalidArgument, "device does not support indexed nodes")
		}
		var count int
		if err = tx.QueryRow(ctx, "SELECT COALESCE((SELECT (value_json::text)::numeric::int FROM device_metadata WHERE device_id=$1 AND key=$2),$3)", id, key, fallback).Scan(&count); err != nil {
			return "", err
		}
		if index > count {
			return "", apperr.New(apperr.KindInvalidArgument, "node index is outside device range")
		}
		names, e := nodeprofile.Names(ctx, tx, id)
		if e != nil {
			return "", e
		}
		old = names[index]
		auditIndex = index
		actorID := entry.ActorID
		if entry.ActorType == audit.ActorSystemAdmin {
			actorID = entry.ActorAdminID
		}
		_, err = tx.Exec(ctx, `INSERT INTO node_profiles(device_id,node_index,name,updated_by,updated_by_type) VALUES($1,$2,$3,$4,$5) ON CONFLICT(device_id,node_index) DO UPDATE SET name=excluded.name,updated_by=excluded.updated_by,updated_by_type=excluded.updated_by_type,updated_at=now()`, id, index, name, actorID, entry.ActorType)
	}
	if err != nil {
		return "", err
	}
	reason, _ := json.Marshal(map[string]any{"node_index": auditIndex, "old_name": old, "new_name": name})
	_, err = tx.Exec(ctx, `INSERT INTO audit_logs(workspace_id,actor_type,actor_id,actor_admin_id,action,resource_type,resource_id,result,reason,ip,user_agent,request_id) VALUES($1,$2,$3,$4,'device.node.rename','device',$5,'success',$6,NULLIF($7,'')::inet,$8,$9)`, entry.WorkspaceID, entry.ActorType, entry.ActorID, entry.ActorAdminID, id, string(reason), entry.IP, entry.UserAgent, entry.RequestID)
	if err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return name, nil
}
