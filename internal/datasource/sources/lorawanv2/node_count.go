package lorawanv2

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/device"
)

type NodeCountResult struct {
	Gateway    LoRaWANV2Gateway          `json:"gateway"`
	Status     string                    `json:"status"`
	WriteState platform.ConfigWriteState `json:"write_state"`
	Warnings   []platform.QueryWarning   `json:"warnings"`
}

// Updating the absolute count is retryable: read first, and never repeat a
// source write already reflected upstream. Only the new slots need projection.
func (s *Service) UpdateNodeCount(ctx context.Context, id, actor uuid.UUID, count int) (NodeCountResult, error) {
	result := NodeCountResult{Warnings: []platform.QueryWarning{}}
	if actor == uuid.Nil || id == uuid.Nil || count < 1 || count > 254 {
		return result, apperr.New(apperr.KindInvalidArgument, "node_count must be an integer between 1 and 254; device and actor are required")
	}
	asset, err := device.NewService(s.DB).GetAsset(ctx, id)
	if err != nil {
		return result, err
	}
	if asset.Status != "active" || asset.DeviceType != "gateway" {
		return result, apperr.New(apperr.KindInvalidArgument, "an active gateway is required")
	}
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return result, err
	}
	source, err := s.loadLoRaWANV2DataSource(ctx, ref.DataSourceID)
	if err != nil {
		return result, err
	}
	client, err := newLoRaWANV2Client(ctx, s.Runtime.Resolver, platform.DataSourceFromSQL(source))
	if err != nil {
		return result, err
	}
	unlock, err := s.LockSourceSync(ctx, source.ID.String()+"/lorawan_v2/"+ref.GatewaySN)
	if err != nil {
		return result, err
	}
	defer unlock()
	gateway, err := client.getGateway(ctx, ref.GatewaySN)
	if err != nil {
		return result, err
	}
	if gateway.SN != ref.GatewaySN || gateway.NodeCount < 0 || gateway.NodeCount > 254 {
		return result, apperr.New(apperr.KindDataSource, "invalid gateway identity or node count from upstream")
	}
	if count < gateway.NodeCount {
		return result, apperr.New(apperr.KindConflict, fmt.Sprintf("源端已有 %d 个节点，节点数量不能减少，请刷新后重试", gateway.NodeCount))
	}
	op, err := s.BeginSourceOperation(ctx, source.ID, &id, "config_update", "running", map[string]any{"kind": "node_count", "previous_count": gateway.NodeCount, "node_count": count}, actor)
	if err != nil {
		return result, err
	}
	result.WriteState = platform.ConfigWriteState{OperationID: op, Source: "unknown", Platform: "pending", Device: "unknown"}
	if count > gateway.NodeCount {
		_, writeErr := client.Request(ctx, http.MethodPost, "/device/"+url.PathEscape(ref.GatewaySN), nil, map[string]int{"node_count": count})
		// Even a timed-out response may have committed; readback determines what
		// the source accepted, independently from hardware application.
		readback, readErr := client.getGateway(ctx, ref.GatewaySN)
		if readErr != nil || readback.SN != ref.GatewaySN || readback.NodeCount < count || readback.NodeCount > 254 {
			cause := readErr
			if cause == nil {
				cause = writeErr
			}
			if cause == nil {
				cause = apperr.New(apperr.KindDataSource, "upstream node count readback did not match")
			}
			_ = s.FinishSourceOperation(op, "unknown", result.WriteState, cause)
			return result, apperr.Wrap(apperr.KindDataSource, "节点数量提交结果未知，请先刷新核对源端；操作 "+op.String(), cause)
		}
		gateway = readback
	}
	result.Gateway = gateway
	result.WriteState.Source = "accepted"
	projectionErr := s.projectNodeCount(ctx, id, source.ID, actor, gateway)
	result.Status, result.WriteState.Platform = "completed", "synced"
	if projectionErr != nil {
		result.Status, result.WriteState.Platform = "partial", "failed"
		result.Warnings = append(result.Warnings, platform.QueryWarning{Code: "platform_sync_failed", Message: "源端节点数已更新，平台同步失败；重试平台同步即可，无需再次增加节点。"})
	}
	if err := s.FinishSourceOperation(op, result.Status, result, projectionErr); err != nil {
		result.Warnings = append(result.Warnings, platform.QueryWarning{Code: "operation_record_failed", Message: "操作记录更新失败，请凭操作 ID 核对源端和平台节点数。"})
	}
	return result, nil
}

func (s *Service) projectNodeCount(ctx context.Context, id, sourceID, actor uuid.UUID, gateway LoRaWANV2Gateway) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	q := s.Queries.WithTx(tx)
	var previous int
	if err = tx.QueryRow(ctx, `SELECT COALESCE((SELECT value_json::text::int FROM device_metadata WHERE device_id=$1 AND key='lorawan_v2_nodes_count'),0)`, id).Scan(&previous); err != nil {
		return err
	}
	if gateway.NodeCount < previous {
		return apperr.New(apperr.KindConflict, "源端节点数小于平台已有节点数，请先核对配置")
	}
	if err = q.UpsertLoRaWANV2Metadata(ctx, sqlc.UpsertLoRaWANV2MetadataParams{DeviceID: id, Key: "lorawan_v2_nodes_count", Name: "LoRa 节点数", ValueType: "number", Column5: []byte(strconv.Itoa(gateway.NodeCount)), CreatedBy: actor}); err != nil {
		return err
	}
	for index := previous + 1; index <= gateway.NodeCount; index++ {
		for key, unit := range loraWANV2NodeDiagnosticMetrics {
			cfg, err := json.Marshal(loraWANV2TelemetryConfig{GatewaySN: gateway.SN, NodeIndex: &index, Metric: key})
			if err != nil {
				return err
			}
			stream, err := q.UpsertDataStreamFromSync(ctx, sqlc.UpsertDataStreamFromSyncParams{DeviceID: id, Code: loraWANV2StreamCode("node_"+strconv.Itoa(index), key), Name: "节点 " + strconv.Itoa(index) + " · " + loraWANV2MetricNames[key], Type: "telemetry", Unit: platform.OptionalString(unit), CreatedBy: actor})
			if err != nil {
				return err
			}
			if _, err = upsertLoRaWANV2DataStreamBinding(ctx, q, sourceID, stream.ID, cfg, actor); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}
