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
	"thcpn-gin/internal/db/sqlc"
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

// ListPhysicalNodes reads the platform directory. Source discovery is handled
// by the worker or an explicit synchronization, not by viewing a node list.
func (s *Service) ListPhysicalNodes(ctx context.Context, deviceID uuid.UUID) (PhysicalNodes, error) {
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, deviceID)
	if err != nil {
		return PhysicalNodes{}, err
	}
	result := PhysicalNodes{GatewaySN: ref.GatewaySN, Data: []PhysicalNode{}}
	rows, err := s.DB.Query(ctx, `SELECT external_id,sn,node_index FROM lorawan_physical_nodes
		WHERE data_source_id=$1 AND gateway_device_id=$2 ORDER BY node_index`, ref.DataSourceID, deviceID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		node := PhysicalNode{GatewaySN: &result.GatewaySN}
		if err := rows.Scan(&node.ID, &node.SN, &node.NodeIndex); err != nil {
			return result, err
		}
		result.Data = append(result.Data, node)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	result.BoundNodeCount = len(result.Data)
	return result, nil
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
	unlock, err := s.waitForNodeSyncLock(ctx, source.ID.String()+"/lorawan_v2/"+ref.GatewaySN)
	if err != nil {
		return PhysicalNodes{}, err
	}
	defer unlock()
	return s.syncPhysicalNodes(ctx, deviceID, source.ID, ref.GatewaySN, client)
}

// Call with the existing per-gateway source sync lock held.
func (s *Service) syncPhysicalNodes(ctx context.Context, deviceID, sourceID uuid.UUID, gatewaySN string, client *LoraWANV2Client) (PhysicalNodes, error) {
	nodes, err := readPhysicalNodes(ctx, client, gatewaySN)
	if err != nil {
		return nodes, err
	}
	return nodes, s.persistPhysicalNodes(ctx, deviceID, sourceID, nodes)
}

func (s *Service) persistPhysicalNodes(ctx context.Context, deviceID, sourceID uuid.UUID, nodes PhysicalNodes) error {
	raw, err := json.Marshal(nodes.Data)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `UPDATE lorawan_physical_nodes p SET gateway_device_id=NULL,node_index=NULL,synced_at=now()
        WHERE gateway_device_id=$1 AND NOT EXISTS (
            SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS n(id bigint,sn text,node_index int)
            WHERE n.id=p.external_id AND n.sn=p.sn AND n.node_index=p.node_index
        )`, deviceID, raw); err != nil {
		return err
	}
	for _, n := range nodes.Data {
		if err = rememberPhysicalNodeBinding(ctx, tx, sourceID, deviceID, n); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE device_metadata SET value_json=$2::jsonb,updated_at=now() WHERE device_id=$1 AND key='lorawan_v2_nodes_count' AND value_json IS DISTINCT FROM $2::jsonb`, deviceID, strconv.Itoa(len(nodes.Data)))
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Once the physical SN is known, a later unbind leaves only historical data.
func rememberPhysicalNodeBinding(ctx context.Context, db sqlc.DBTX, sourceID, deviceID uuid.UUID, node PhysicalNode) error {
	_, err := db.Exec(ctx, `WITH binding AS (
        INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(data_source_id,external_id) DO UPDATE SET sn=EXCLUDED.sn,gateway_device_id=EXCLUDED.gateway_device_id,node_index=EXCLUDED.node_index,
            synced_at=CASE WHEN (lorawan_physical_nodes.sn,lorawan_physical_nodes.gateway_device_id,lorawan_physical_nodes.node_index)
                IS DISTINCT FROM (EXCLUDED.sn,EXCLUDED.gateway_device_id,EXCLUDED.node_index) THEN now() ELSE lorawan_physical_nodes.synced_at END
        RETURNING gateway_device_id,node_index
    )
    DELETE FROM lorawan_legacy_nodes legacy USING binding
    WHERE legacy.gateway_device_id=binding.gateway_device_id AND legacy.node_index=binding.node_index`, sourceID, node.ID, node.SN, deviceID, *node.NodeIndex)
	return err
}

func (s *Service) RememberRegisteredNode(ctx context.Context, sourceID uuid.UUID, raw json.RawMessage) error {
	var node PhysicalNode
	if json.Unmarshal(raw, &node) != nil || node.ID <= 0 || node.SN == "" || node.NodeIndex != nil || node.GatewaySN != nil {
		return apperr.New(apperr.KindDataSource, "invalid registered physical node")
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn) VALUES($1,$2,$3) ON CONFLICT(data_source_id,external_id) DO UPDATE SET sn=EXCLUDED.sn,synced_at=now()`, sourceID, node.ID, node.SN)
	return err
}
