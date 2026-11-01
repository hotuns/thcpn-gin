package lorawanv2

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"github.com/google/uuid"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

type NodeRegistration struct {
	SN              string     `json:"sn"`
	GatewayDeviceID *uuid.UUID `json:"gateway_device_id,omitempty"`
	NodeIndex       int        `json:"node_index"`
}
type NodeRegistrationResult struct {
	PhysicalNodeResult
	Created bool `json:"created"`
	Bound   bool `json:"bound"`
}
type NodeImportRow struct {
	Line      int    `json:"line"`
	SN        string `json:"sn"`
	NodeIndex int    `json:"node_index"`
	Error     string `json:"error,omitempty"`
}
type NodeGateway struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	SN   string    `json:"sn"`
}

func (s *Service) NodeGateways(ctx context.Context, source uuid.UUID) ([]NodeGateway, error) {
	if _, err := s.loadLoRaWANV2DataSource(ctx, source); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(ctx, `SELECT d.id,d.name,r.external_key FROM device_source_refs r JOIN devices d ON d.id=r.device_id WHERE r.data_source_id=$1 AND r.adapter_code='lorawan_v2' AND r.status='active' AND d.device_type='gateway' AND d.status='active' ORDER BY d.name,d.id`, source)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []NodeGateway{}
	for rows.Next() {
		var item NodeGateway
		if err := rows.Scan(&item.ID, &item.Name, &item.SN); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
func ParseNodeCSV(input string) ([]NodeImportRow, error) {
	if len(input) > 256*1024 {
		return nil, apperr.New(apperr.KindInvalidArgument, "CSV 文件过大，请限制在 256 KB 内")
	}
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(input, "\ufeff")))
	reader.FieldsPerRecord = -1
	result := []NodeImportRow{}
	seenSN := map[string]int{}
	seenIndex := map[int]int{}
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, apperr.New(apperr.KindInvalidArgument, "CSV 格式无效，请使用两列：sn,node_index")
		}
		line, _ := reader.FieldPos(0)
		if len(record) == 2 && strings.EqualFold(strings.TrimSpace(record[0]), "sn") && (strings.EqualFold(strings.TrimSpace(record[1]), "node_index") || strings.TrimSpace(record[1]) == "序号") && len(result) == 0 {
			continue
		}
		item := NodeImportRow{Line: line}
		if len(record) != 2 {
			item.Error = "必须恰好两列：SN、序号"
		} else {
			item.SN = strings.TrimSpace(record[0])
			item.NodeIndex, _ = strconv.Atoi(strings.TrimSpace(record[1]))
			if item.SN == "" || len(item.SN) > 64 {
				item.Error = "SN 必填，最长 64 字节"
			}
			if item.NodeIndex < 1 || item.NodeIndex > 254 {
				item.Error = "序号必须是 1–254 的整数"
			}
		}
		i := len(result)
		if previous, ok := seenSN[item.SN]; ok && item.SN != "" {
			item.Error = "文件内 SN 重复"
			result[previous].Error = "文件内 SN 重复"
		} else {
			seenSN[item.SN] = i
		}
		if previous, ok := seenIndex[item.NodeIndex]; ok && item.NodeIndex > 0 {
			item.Error = "文件内序号重复"
			result[previous].Error = "文件内序号重复"
		} else {
			seenIndex[item.NodeIndex] = i
		}
		result = append(result, item)
		if len(result) > 254 {
			return nil, apperr.New(apperr.KindInvalidArgument, "单次最多导入 254 个节点")
		}
	}
	if len(result) == 0 {
		return nil, apperr.New(apperr.KindInvalidArgument, "CSV 中没有节点记录")
	}
	return result, nil
}
func (s *Service) RegisterPhysicalNode(ctx context.Context, source, actor uuid.UUID, input NodeRegistration) (result NodeRegistrationResult, err error) {
	input.SN = strings.TrimSpace(input.SN)
	if actor == uuid.Nil || input.SN == "" || len(input.SN) > 64 {
		return result, apperr.New(apperr.KindInvalidArgument, "SN 必填，最长 64 字节")
	}
	sourceRow, err := s.loadLoRaWANV2DataSource(ctx, source)
	if err != nil {
		return result, err
	}
	client, err := newLoRaWANV2Client(ctx, s.Runtime.Resolver, platform.DataSourceFromSQL(sourceRow))
	if err != nil {
		return result, err
	}
	var gatewaySN string
	if input.GatewayDeviceID != nil {
		if input.NodeIndex < 1 || input.NodeIndex > 254 {
			return result, apperr.New(apperr.KindInvalidArgument, "序号必须是 1–254 的整数")
		}
		ref, e := s.LoRaWANV2GatewayForDevice(ctx, *input.GatewayDeviceID)
		if e != nil {
			return result, e
		}
		if ref.DataSourceID != source {
			return result, apperr.New(apperr.KindInvalidArgument, "网关不属于当前数据源")
		}
		gatewaySN = ref.GatewaySN
		nodes, e := readPhysicalNodes(ctx, client, ref.GatewaySN)
		if e != nil {
			return result, e
		}
		for _, node := range nodes.Data {
			if *node.NodeIndex == input.NodeIndex {
				return result, apperr.New(apperr.KindConflict, "目标序号已被占用，请使用更换节点功能")
			}
		}
	}
	raw, err := client.Request(ctx, http.MethodGet, "/nodes", url.Values{"sn": {input.SN}, "page_size": {"1"}, "page": {"1"}}, nil)
	if err != nil {
		return result, err
	}
	var existing struct {
		Data []PhysicalNode `json:"data"`
	}
	if json.Unmarshal(raw, &existing) != nil || existing.Data == nil {
		return result, apperr.New(apperr.KindDataSource, "invalid physical node inventory")
	}
	if len(existing.Data) > 0 {
		return result, apperr.New(apperr.KindConflict, "此 SN 已登记；导入仅新建节点，不复用或移动已有节点")
	}
	op, err := s.BeginSourceOperation(ctx, source, input.GatewayDeviceID, "config_update", "running", input, actor)
	if err != nil {
		return result, err
	}
	result.OperationID = op
	result.Status = "unknown"
	var operationErr error
	defer func() {
		if finishErr := s.FinishSourceOperation(op, result.Status, result, func() error {
			if operationErr != nil {
				return operationErr
			}
			return err
		}()); finishErr != nil {
			result.Message += " 操作记录更新失败，请保留操作 ID 核对。"
		}
	}()
	raw, err = client.Request(ctx, http.MethodPost, "/nodes", nil, map[string]string{"sn": input.SN})
	if err != nil {
		operationErr = err
		result.Message = "新建结果未确认，请按 SN 查询核对，不要重复导入；操作 " + op.String()
		err = nil
		return result, nil
	}
	result.Created = true
	result.Payload = raw
	cacheErr := s.RememberRegisteredNode(ctx, source, raw)
	if input.GatewayDeviceID != nil {
		raw, err = client.Request(ctx, http.MethodPut, "/nodes/"+url.PathEscape(input.SN)+"/binding", nil, map[string]any{"gateway_sn": gatewaySN, "node_index": input.NodeIndex})
		if err != nil {
			operationErr = err
			result.Status = "partial"
			result.Message = "节点已新建，但安装未确认。请在库存核对；不要再次新建同一 SN。"
			err = nil
			return result, nil
		}
		var node PhysicalNode
		if json.Unmarshal(raw, &node) != nil || node.ID <= 0 || node.SN != input.SN || node.GatewaySN == nil || *node.GatewaySN != gatewaySN || node.NodeIndex == nil || *node.NodeIndex != input.NodeIndex {
			result.Status = "unknown"
			result.Message = "节点已新建，绑定返回内容不匹配，请核对源端。"
			return result, nil
		}
		result.Bound = true
		result.Payload = raw
		if cacheErr == nil {
			_, cacheErr = s.DB.Exec(ctx, `UPDATE lorawan_physical_nodes SET gateway_device_id=$3,node_index=$4,synced_at=now() WHERE data_source_id=$1 AND external_id=$2`, source, node.ID, *input.GatewayDeviceID, input.NodeIndex)
		}
	}
	result.Status = "completed"
	result.Message = "节点已新建"
	if result.Bound {
		result.Message = "节点已新建并安装到指定序号；未发送硬件指令"
	}
	if cacheErr != nil {
		operationErr = cacheErr
		result.Status = "partial"
		result.Message = "源端已接受，平台投影失败，请同步平台，不要再次新建。"
	}
	return result, nil
}
