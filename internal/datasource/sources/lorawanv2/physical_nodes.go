package lorawanv2

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/url"
	"strconv"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

type PhysicalNode struct {
	ID        int64   `json:"id"`
	SN        string  `json:"sn"`
	GatewaySN *string `json:"gateway_sn"`
	NodeIndex *int    `json:"node_index"`
}
type PhysicalNodes struct {
	GatewaySN      string         `json:"gateway_sn"`
	BoundNodeCount int            `json:"bound_node_count"`
	Data           []PhysicalNode `json:"data"`
}

func readPhysicalNodes(ctx context.Context, client *LoraWANV2Client, sn string) (PhysicalNodes, error) {
	raw, err := client.Request(ctx, http.MethodGet, "/device/"+url.PathEscape(sn)+"/nodes", nil, nil)
	var result PhysicalNodes
	if err != nil {
		return result, err
	}
	if json.Unmarshal(raw, &result) != nil || result.GatewaySN != sn || result.Data == nil || result.BoundNodeCount != len(result.Data) {
		return result, apperr.New(apperr.KindDataSource, "invalid physical node list")
	}
	seen := map[int]bool{}
	for _, n := range result.Data {
		if n.ID <= 0 || n.SN == "" || n.GatewaySN == nil || *n.GatewaySN != sn || n.NodeIndex == nil || *n.NodeIndex < 1 || *n.NodeIndex > 254 || seen[*n.NodeIndex] {
			return result, apperr.New(apperr.KindDataSource, "invalid physical node binding")
		}
		seen[*n.NodeIndex] = true
	}
	return result, nil
}

// Refresh bindings without changing stream IDs, position profiles or historical configurations.
func (s *Service) SyncPhysicalNodes(ctx context.Context, deviceID uuid.UUID) (PhysicalNodes, error) {
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, deviceID)
	if err != nil {
		return PhysicalNodes{}, err
	}
	source, err := s.loadLoRaWANV2DataSource(ctx, ref.DataSourceID)
	if err != nil {
		return PhysicalNodes{}, err
	}
	client, err := newLoRaWANV2Client(ctx, s.Runtime.Resolver, platform.DataSourceFromSQL(source))
	if err != nil {
		return PhysicalNodes{}, err
	}
	nodes, err := readPhysicalNodes(ctx, client, ref.GatewaySN)
	if err != nil {
		return nodes, err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nodes, err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `UPDATE lorawan_physical_nodes SET gateway_device_id=NULL,node_index=NULL,synced_at=now() WHERE gateway_device_id=$1`, deviceID); err != nil {
		return nodes, err
	}
	for _, n := range nodes.Data {
		_, err = tx.Exec(ctx, `INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index) VALUES($1,$2,$3,$4,$5) ON CONFLICT(data_source_id,external_id) DO UPDATE SET sn=EXCLUDED.sn,gateway_device_id=EXCLUDED.gateway_device_id,node_index=EXCLUDED.node_index,synced_at=now()`, ref.DataSourceID, n.ID, n.SN, deviceID, *n.NodeIndex)
		if err != nil {
			return nodes, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE device_metadata SET value_json=$2::jsonb,updated_at=now() WHERE device_id=$1 AND key='lorawan_v2_nodes_count'`, deviceID, strconv.Itoa(len(nodes.Data)))
	if err != nil {
		return nodes, err
	}
	return nodes, tx.Commit(ctx)
}

func (s *Service) RememberRegisteredNode(ctx context.Context, sourceID uuid.UUID, raw json.RawMessage) error {
	var node PhysicalNode
	if json.Unmarshal(raw, &node) != nil || node.ID <= 0 || node.SN == "" || node.NodeIndex != nil || node.GatewaySN != nil {
		return apperr.New(apperr.KindDataSource, "invalid registered physical node")
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn) VALUES($1,$2,$3) ON CONFLICT(data_source_id,external_id) DO UPDATE SET sn=EXCLUDED.sn,synced_at=now()`, sourceID, node.ID, node.SN)
	return err
}
