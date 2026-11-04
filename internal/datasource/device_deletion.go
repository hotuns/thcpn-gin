package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"strings"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/httpx"
	"unicode/utf8"
)

type deletionInput struct {
	Confirmation string `json:"confirmation"`
	Reason       string `json:"reason"`
	ExpectedID   int64  `json:"expected_id"`
}

type deletionResult struct {
	Allowed      bool       `json:"allowed"`
	Reasons      []string   `json:"reasons"`
	State        string     `json:"state"`
	Name         string     `json:"name"`
	Confirmation string     `json:"confirmation"`
	DeviceType   string     `json:"device_type"`
	Scope        string     `json:"scope"`
	ExpectedID   int64      `json:"expected_id"`
	OperationID  *uuid.UUID `json:"operation_id,omitempty"`
}

type deletionTarget struct {
	device, source uuid.UUID
	sn             string
	nodeID         int64
}

func (h *Handler) AdminDeviceDeletion(c *gin.Context) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	h.adminDeleteAsset(c, deletionTarget{device: id})
}
func (h *Handler) AdminPhysicalNodeDeletion(c *gin.Context) {
	source, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	sn := strings.TrimSpace(c.Param("node_sn"))
	id, err := strconv.ParseInt(c.Param("node_id"), 10, 64)
	if sn == "" || len(sn) > 64 || strings.ContainsAny(sn, "/?#%") || err != nil || id <= 0 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "节点身份无效"))
		return
	}
	h.adminDeleteAsset(c, deletionTarget{source: source, sn: sn, nodeID: id})
}
func (h *Handler) adminDeleteAsset(c *gin.Context, target deletionTarget) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return
	}
	var input deletionInput
	execute := c.Request.Method == http.MethodDelete
	if execute {
		if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 300 {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "请填写删除原因（最多 300 字）"))
			return
		}
		if !h.record(c, deletionAudit(actor.UserID, target, "device.delete.request", audit.ResultSuccess, input.Reason)) {
			return
		}
	}
	result, err := h.service.deleteAsset(c.Request.Context(), target, input, actor.UserID, execute)
	if execute {
		outcome := audit.ResultFailure
		if err == nil && result.State == "deleted" {
			outcome = audit.ResultSuccess
		}
		reason := input.Reason + "；" + result.State
		if err != nil {
			reason += "；" + apperr.MessageOf(err)
		}
		if result.OperationID != nil {
			reason += "；操作 " + result.OperationID.String()
		}
		if !h.record(c, deletionAudit(actor.UserID, target, "device.delete", outcome, reason)) {
			return
		}
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func deletionAudit(actor uuid.UUID, t deletionTarget, action string, outcome string, reason string) audit.RecordInput {
	resource, id := "device", t.device
	if t.nodeID > 0 {
		resource, id = "data_source", t.source
		reason = "节点 " + t.sn + " / " + strconv.FormatInt(t.nodeID, 10) + "；" + reason
	}
	return audit.RecordInput{ActorID: audit.UserActorID(actor), Action: action, ResourceType: resource, ResourceID: audit.ResourceID(id), Result: outcome, Reason: reason}
}

func (s *Service) deleteAsset(ctx context.Context, t deletionTarget, input deletionInput, actor uuid.UUID, execute bool) (result deletionResult, err error) {
	result = deletionResult{Reasons: []string{}, State: "blocked"}
	if t.nodeID > 0 {
		key := "node-delete/" + t.source.String() + "/" + strconv.FormatInt(t.nodeID, 10)
		unlock, err := s.LockSourceSync(ctx, key)
		if err != nil {
			return result, err
		}
		defer unlock()
	}
	// Resolve the gateway lock before acquiring the device row, in the same order as sync.
	if t.nodeID == 0 {
		refs, err := s.Queries.DeviceDeletionSources(ctx, t.device)
		if err != nil {
			return result, err
		}
		if len(refs) == 1 && refs[0].AdapterCode == "lorawan_v2" {
			unlock, err := s.LockSourceSync(ctx, refs[0].DataSourceID.String()+"/lorawan_v2/"+refs[0].ExternalKey)
			if err != nil {
				return result, err
			}
			defer unlock()
		}
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	q := s.Queries.WithTx(tx)
	assetKey := t.device.String()
	var sourceCheck func(int64, bool) (platform.SourceDeletion, error)
	var gatewaySN string
	if t.nodeID > 0 {
		assetKey = "node:" + strconv.FormatInt(t.nodeID, 10)
		result.Name, result.Confirmation, result.DeviceType = t.sn, t.sn, "LoRaWAN V2 节点"
		result.ExpectedID = t.nodeID
		result.Scope = "永久删除源端节点库存登记和平台副本，释放 SN。"
		bound, err := q.IsPhysicalNodeProjectedAsBound(ctx, sqlc.IsPhysicalNodeProjectedAsBoundParams{DataSourceID: t.source, ExternalID: t.nodeID})
		if err != nil {
			return result, err
		}
		if bound {
			result.Reasons = append(result.Reasons, "节点仍有平台绑定记录")
		}
		sourceCheck = func(id int64, exec bool) (platform.SourceDeletion, error) {
			return s.LoRaWAN.DeleteUnusedSourceAsset(ctx, t.source, t.sn, id, true, exec)
		}
	} else {
		asset, err := q.LockDeviceForDeletion(ctx, t.device)
		if err != nil {
			return result, platform.MapNotFoundOrInternal(err, "设备不存在")
		}
		result.Name, result.Confirmation, result.DeviceType = asset.Name, asset.SerialNo, asset.DeviceType
		if result.Confirmation == "" {
			result.Confirmation = asset.ID.String()
		}
		result.Reasons, err = q.DeviceDeletionBlockers(ctx, t.device)
		if err != nil {
			return result, err
		}
		if asset.LifecycleStatus != "inbound" {
			result.Reasons = append(result.Reasons, "仅待安装的误建设备可删除")
		}
		refs, err := q.DeviceDeletionSources(ctx, t.device)
		if err != nil {
			return result, err
		}
		switch {
		case len(refs) == 0 && asset.DeviceType == "camera":
			serial, bindingErr := q.DeviceDeletionCameraSN(ctx, t.device)
			if bindingErr != nil && !errors.Is(bindingErr, pgx.ErrNoRows) {
				return result, bindingErr
			}
			result.Confirmation = strings.TrimSpace(serial)
			if result.Confirmation == "" {
				result.Confirmation = t.device.String()
			}

			result.Scope = "永久删除平台视频站登记及通道绑定；不修改萤石云设备、通道或录像。"
		case len(refs) != 1 || refs[0].Status != "active":
			result.Reasons = append(result.Reasons, "无法确认唯一有效的源端设备")
		default:
			ref := refs[0]
			t.source = ref.DataSourceID
			switch ref.AdapterCode {
			case "lorawan_v2":
				gatewaySN = ref.ExternalKey
				result.Confirmation = gatewaySN
				result.DeviceType = "LoRaWAN V2 网关"
				result.Scope = "永久删除源端网关登记、默认配置及平台资产，释放 SN。"
				sourceCheck = func(id int64, exec bool) (platform.SourceDeletion, error) {
					return s.LoRaWAN.DeleteUnusedSourceAsset(ctx, t.source, gatewaySN, id, false, exec)
				}
			case "thcpn_legacy_mysql", "carbon_sink_mysql":
				result.ExpectedID, err = strconv.ParseInt(ref.ExternalKey, 10, 64)
				if err != nil || result.ExpectedID <= 0 {
					result.Reasons = append(result.Reasons, "源端设备 ID 无效")
				}
				result.Scope = "停用源端登记以防止重新同步，永久删除平台资产。"
				fn := s.THCPN.DeleteUnusedSourceDevice
				if ref.AdapterCode == "carbon_sink_mysql" {
					fn = s.Carbon.DeleteUnusedSourceDevice
				}
				sourceCheck = func(id int64, exec bool) (platform.SourceDeletion, error) { return fn(ctx, t.source, id, exec) }
			default:
				result.Reasons = append(result.Reasons, "该数据源不支持安全删除")
			}
		}
	}
	if len(result.Reasons) > 0 {
		return result, nil
	}
	if execute && strings.TrimSpace(input.Confirmation) != result.Confirmation {
		return result, apperr.New(apperr.KindInvalidArgument, "确认内容与设备 SN 或 ID 不一致")
	}
	var opID uuid.UUID
	if sourceCheck != nil {
		op, findErr := q.DeletionOperationForAsset(ctx, sqlc.DeletionOperationForAssetParams{DataSourceID: t.source, Asset: assetKey})
		if findErr == nil {
			var saved struct {
				ExpectedID int64 `json:"expected_id"`
			}
			if json.Unmarshal(op.Request, &saved) != nil || saved.ExpectedID <= 0 {
				return result, apperr.New(apperr.KindInternal, "删除操作记录缺少源端身份")
			}
			result.ExpectedID, opID = saved.ExpectedID, op.ID
			result.OperationID = &opID
		} else if !errors.Is(findErr, pgx.ErrNoRows) {
			return result, findErr
		}
		if gatewaySN != "" && opID == uuid.Nil {
			result.ExpectedID, err = s.LoRaWAN.GatewayDeletionID(ctx, t.source, gatewaySN)
			if err != nil {
				result.Reasons = append(result.Reasons, "无法核实源端网关身份："+apperr.MessageOf(err))
				return result, nil
			}
		}
		if execute && input.ExpectedID != result.ExpectedID {
			return result, apperr.New(apperr.KindConflict, "设备身份已变化，请重新检查删除条件")
		}
		checked, checkErr := sourceCheck(result.ExpectedID, false)
		if checkErr != nil {
			result.Reasons = append(result.Reasons, "无法核实源端删除条件，请检查数据源和服务版本")
			return result, nil
		}
		switch checked.State {
		case "eligible":
		case "absent":
			if opID == uuid.Nil {
				result.Reasons = append(result.Reasons, "源端记录不存在，无法确认设备历史")
				return result, nil
			}
			result.State = "partial"
		case "blocked":
			result.Reasons = append(result.Reasons, checked.Reasons...)
			return result, nil
		default:
			result.Reasons = append(result.Reasons, "源端删除预检结果无效")
			return result, nil
		}
		if execute && checked.State == "eligible" {
			if opID == uuid.Nil {
				opID, err = s.BeginSourceOperation(ctx, t.source, nil, "device_delete", "running", map[string]any{"asset": assetKey, "expected_id": result.ExpectedID, "confirmation": result.Confirmation, "reason": input.Reason}, actor)
				if err != nil {
					return result, err
				}
				result.OperationID = &opID
			}
			outcome, callErr := sourceCheck(result.ExpectedID, true)
			if callErr != nil {
				_ = s.FinishSourceOperation(opID, "unknown", map[string]string{"source": "unknown", "platform": "unchanged"}, callErr)
				result.State = "unknown"
				result.Reasons = append(result.Reasons, "源端删除结果待核对，请重新检查后继续")
				return result, nil
			}
			if outcome.State != "deleted" && outcome.State != "absent" {
				_ = s.FinishSourceOperation(opID, "failed", outcome, nil)
				result.Reasons = append(result.Reasons, outcome.Reasons...)
				if len(result.Reasons) == 0 {
					result.Reasons = append(result.Reasons, "源端未确认删除")
				}
				return result, nil
			}
			result.State = "partial"
			_ = s.FinishSourceOperation(opID, "partial", map[string]string{"source": "deleted", "platform": "pending"}, nil)
		}
	}
	result.Allowed = true
	if result.State != "partial" {
		result.State = "eligible"
	}
	if !execute {
		return result, nil
	}
	if t.nodeID > 0 {
		err = q.DeleteUnusedPhysicalNodeProjection(ctx, sqlc.DeleteUnusedPhysicalNodeProjectionParams{DataSourceID: t.source, ExternalID: t.nodeID, Sn: t.sn})
	} else {
		if err = q.RemoveUnusedDeviceInstallation(ctx, t.device); err == nil {
			err = q.RemoveUnusedGatewayDetails(ctx, t.device)
		}
		if err == nil {
			_, err = q.DeleteUnusedDevice(ctx, t.device)
		}
	}
	if err == nil && opID != uuid.Nil {
		err = q.CompleteDeviceDeletionOperation(ctx, opID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil && result.State == "partial" {
		result.Reasons = append(result.Reasons, "源端已删除，平台待清理；请重新检查并继续清理")
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.State = "deleted"
	return result, nil
}

// The inventory reads from the source, so a removed node needs a separate
// recovery entry until the platform projection has been cleared.
func (h *Handler) AdminPendingPhysicalNodeDeletions(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return
	}
	source, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	rows, err := h.service.Queries.ListPendingPhysicalNodeDeletions(c.Request.Context(), source)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	type item struct {
		ID int64  `json:"id"`
		SN string `json:"sn"`
	}
	items := []item{}
	for _, raw := range rows {
		var saved struct {
			ExpectedID   int64  `json:"expected_id"`
			Confirmation string `json:"confirmation"`
		}
		if json.Unmarshal(raw, &saved) == nil && saved.ExpectedID > 0 && saved.Confirmation != "" {
			items = append(items, item{saved.ExpectedID, saved.Confirmation})
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
