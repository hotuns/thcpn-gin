package lorawanv2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/datasource/platform"
)

// Node discovery belongs to the receiving service. This worker only projects
// its current bindings and sensor configuration into the platform catalogue.
type NodeDiscoveryReconcileResult struct {
	Gateways int `json:"gateways"`
	Nodes    int `json:"nodes"`
	Failed   int `json:"failed"`
}

func (s *Service) ReconcileDiscoveredNodes(ctx context.Context) (NodeDiscoveryReconcileResult, error) {
	var result NodeDiscoveryReconcileResult
	rows, err := s.DB.Query(ctx, `SELECT r.device_id FROM device_source_refs r
		JOIN devices d ON d.id=r.device_id JOIN data_sources ds ON ds.id=r.data_source_id
		WHERE r.adapter_code='lorawan_v2' AND r.status='active' AND d.status='active'
		AND d.lifecycle_status<>'retired' AND d.device_type='gateway' AND ds.status='active' AND ds.source_family='lorawan_v2'
		ORDER BY r.device_id`)
	if err != nil {
		return result, err
	}
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return result, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	var failures []error
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return result, errors.Join(append(failures, err)...)
		}
		// An unavailable gateway must not hold up every other gateway indefinitely.
		gatewayCtx, cancel := context.WithTimeout(ctx, time.Minute)
		nodes, err := s.RefreshDiscoveredNodes(gatewayCtx, id)
		cancel()
		result.Gateways++
		result.Nodes += len(nodes.Data)
		if err != nil {
			result.Failed++
			failures = append(failures, fmt.Errorf("gateway %s: %w", id, err))
		}
	}
	return result, errors.Join(failures...)
}

type discoveryCatalogue struct {
	metrics             map[string]bool
	measurement         bool
	projectedAt         time.Time
	measurementSyncedAt time.Time
}

func (c discoveryCatalogue) hasDiagnostics() bool {
	for key := range loraWANV2NodeDiagnosticMetrics {
		if !c.metrics[key] {
			return false
		}
	}
	return true
}

// RefreshDiscoveredNodes never registers, binds, replaces or configures source
// hardware. Existing gateway/index metadata and stream IDs retain their meaning.
func (s *Service) RefreshDiscoveredNodes(ctx context.Context, deviceID uuid.UUID) (PhysicalNodes, error) {
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

	// Validate a complete source response before changing the cached directory.
	nodes, err := readPhysicalNodes(ctx, client, ref.GatewaySN)
	if err != nil {
		return nodes, err
	}
	previous := map[int]PhysicalNode{}
	boundAt := map[int]time.Time{}
	rows, err := s.DB.Query(ctx, `SELECT external_id,sn,node_index,synced_at FROM lorawan_physical_nodes WHERE gateway_device_id=$1`, deviceID)
	if err != nil {
		return nodes, err
	}
	for rows.Next() {
		var node PhysicalNode
		var index int
		var syncedAt time.Time
		if err := rows.Scan(&node.ID, &node.SN, &index, &syncedAt); err != nil {
			rows.Close()
			return nodes, err
		}
		previous[index] = node
		boundAt[index] = syncedAt
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nodes, err
	}
	changed := map[int]bool{}
	for _, node := range nodes.Data {
		old, exists := previous[*node.NodeIndex]
		if !exists || old.ID != node.ID || old.SN != node.SN {
			changed[*node.NodeIndex] = true
		}
	}
	if len(changed) > 0 || len(previous) != len(nodes.Data) {
		if err := s.persistPhysicalNodes(ctx, deviceID, source.ID, nodes); err != nil {
			return nodes, err
		}
	}

	catalogues := map[int]discoveryCatalogue{}
	rows, err = s.DB.Query(ctx, `SELECT (b.adapter_config_json->>'node_index')::int,
		b.adapter_config_json->>'metric',ds.purpose,b.updated_at FROM data_streams ds
		JOIN data_stream_bindings b ON b.data_stream_id=ds.id
		WHERE ds.device_id=$1 AND b.data_source_id=$2 AND b.adapter_code='lorawan_v2'
		AND ds.status='active' AND b.status='active'
		AND b.adapter_config_json->>'gateway_sn'=$3 AND b.adapter_config_json ? 'node_index'`, deviceID, source.ID, ref.GatewaySN)
	if err != nil {
		return nodes, err
	}
	for rows.Next() {
		var index int
		var metric, purpose string
		var updatedAt time.Time
		if err := rows.Scan(&index, &metric, &purpose, &updatedAt); err != nil {
			rows.Close()
			return nodes, err
		}
		catalog := catalogues[index]
		if catalog.metrics == nil {
			catalog.metrics = map[string]bool{}
		}
		catalog.metrics[metric] = true
		if purpose == "measurement" {
			catalog.measurement = true
			if updatedAt.After(catalog.measurementSyncedAt) {
				catalog.measurementSyncedAt = updatedAt
			}
		}
		if metric == "battery" {
			catalog.projectedAt = updatedAt
		}
		catalogues[index] = catalog
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nodes, err
	}

	// Only an explicit legacy marker or a source binding makes a slot current.
	// Existing profiles and historical streams are not evidence of installation.
	current := make([]int, 0, len(nodes.Data))
	for _, node := range nodes.Data {
		current = append(current, *node.NodeIndex)
	}
	rows, err = s.DB.Query(ctx, `SELECT legacy.node_index FROM lorawan_legacy_nodes legacy
		WHERE legacy.gateway_device_id=$1 AND NOT EXISTS (
			SELECT 1 FROM lorawan_physical_nodes p
			WHERE p.gateway_device_id=legacy.gateway_device_id AND p.node_index=legacy.node_index
		) ORDER BY legacy.node_index`, deviceID)
	if err != nil {
		return nodes, err
	}
	legacy, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return nodes, err
	}
	current = append(current, legacy...)

	var gateway *LoRaWANV2Gateway
	var failures []error
	for _, index := range current {
		catalog := catalogues[index]
		pending := changed[index] || catalog.projectedAt.Before(boundAt[index])
		// A replacement can have old measurements in the catalogue while
		// the source has no configuration yet. Projecting only diagnostics
		// must not mark those old measurements as synced to the new binding.
		staleMeasurements := catalog.measurement && catalog.measurementSyncedAt.Before(boundAt[index])
		if !pending && !staleMeasurements && catalog.measurement && catalog.hasDiagnostics() {
			continue
		}
		if gateway == nil {
			value, err := client.getGateway(ctx, ref.GatewaySN)
			if err != nil {
				return nodes, err
			}
			gateway = &value
		}
		// Missing configuration is a valid pending state: expose built-in runtime
		// streams, then retry this node on a later scan without scanning empty slots.
		specs, err := loraWANV2DiscoverStreams(ctx, client, *gateway, index)
		if err != nil {
			failures = append(failures, fmt.Errorf("node %d: %w", index, err))
			continue
		}
		needsWrite, configured := pending, false
		for _, spec := range specs {
			var binding loraWANV2TelemetryConfig
			if err := json.Unmarshal(spec.AdapterConfig, &binding); err != nil {
				return nodes, err
			}
			needsWrite = needsWrite || !catalog.metrics[binding.Metric]
			configured = configured || spec.ConfigHash != ""
		}
		if !needsWrite && !(configured && staleMeasurements) {
			continue
		}
		var scope []int
		if configured {
			scope = []int{index}
		}
		if err := s.persistDiscoveredNodeStreams(ctx, source.ID, deviceID, source.CreatedBy, specs, scope...); err != nil {
			failures = append(failures, fmt.Errorf("node %d: %w", index, err))
		}
	}
	return nodes, errors.Join(failures...)
}

func (s *Service) persistDiscoveredNodeStreams(ctx context.Context, sourceID, deviceID, actorID uuid.UUID, specs []loraWANV2StreamSpec, scope ...int) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, _, err := s.projectLoRaWANV2Streams(ctx, tx, sourceID, deviceID, specs, false, actorID, scope...); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
