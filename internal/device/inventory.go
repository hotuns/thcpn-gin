package device

import (
	"context"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

// InventoryAsset is the device data included in the administrator's inventory workbook.
type InventoryAsset struct {
	ID              uuid.UUID
	AssetNo         string
	Name            string
	DeviceType      string
	SourceFamily    string
	ExternalKey     string
	HardwareSN      string
	LifecycleStatus string
	Status          string
	WorkspaceName   string
	ProjectName     string
	SiteName        string
	Address         string
	ICCID           string
	InstalledOn     string
	Installer       string
	CustomerOrg     string
	DeliveryProject string
	ContactName     string
	ContactPhone    string
	OpsTags         string
}

type InventoryNode struct {
	GatewayAssetNo string
	GatewayName    string
	GatewaySN      string
	AssetNo        string
	Name           string
	SN             string
	Index          *int
}

// LoadInventory reads the requested assets and their current node relationships.
// It does not read telemetry, pending discoveries, or unbound historical positions.
func (s *Service) LoadInventory(ctx context.Context, ids []uuid.UUID, includeNodes bool) ([]InventoryAsset, []InventoryNode, error) {
	assets, err := s.loadInventoryAssets(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	if !includeNodes {
		return assets, nil, nil
	}
	nodes, err := s.loadInventoryNodes(ctx, assets)
	if err != nil {
		return nil, nil, err
	}
	return assets, nodes, nil
}

func (s *Service) loadInventoryAssets(ctx context.Context, ids []uuid.UUID) ([]InventoryAsset, error) {
	rows, err := s.db.Query(ctx, `
		SELECT d.id, COALESCE(d.asset_no, ''), d.name, d.device_type,
		       COALESCE(src.source_family, ''), COALESCE(ref.external_key, ''),
		       COALESCE(d.hardware_sn, ''), d.lifecycle_status, d.status,
		       COALESCE(w.name, ''), COALESCE(p.name, ''), COALESCE(site.name, ''),
		       COALESCE(profile.location_text, ''), COALESCE(d.iccid, ''),
		       COALESCE(to_char(dossier.installed_on, 'YYYY-MM-DD'), ''), COALESCE(installer.name, ''),
		       COALESCE(dossier.organization, ''), COALESCE(NULLIF(p.name, ''), dossier.project_name, ''),
		       COALESCE(dossier.contact_name, ''), COALESCE(dossier.contact_phone, ''),
		       COALESCE(array_to_string(dossier.ops_tags, '、'), '')
		FROM unnest($1::uuid[]) WITH ORDINALITY AS selected(id, ordinal)
		JOIN devices d ON d.id = selected.id
		LEFT JOIN device_source_refs ref ON ref.device_id = d.id AND ref.status = 'active'
		LEFT JOIN data_sources src ON src.id = ref.data_source_id
		LEFT JOIN device_assignments a ON a.device_id = d.id AND a.status = 'active'
		LEFT JOIN workspaces w ON w.id = a.workspace_id
		LEFT JOIN projects p ON p.id = a.project_id
		LEFT JOIN sites site ON site.id = a.site_id
		LEFT JOIN device_profiles profile ON profile.device_id = d.id
		LEFT JOIN device_installation_records dossier ON dossier.device_id = d.id
		LEFT JOIN system_admins installer ON installer.id = dossier.installer_id
		ORDER BY selected.ordinal`, ids)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "读取设备清单失败", err)
	}
	defer rows.Close()
	assets := make([]InventoryAsset, 0, len(ids))
	for rows.Next() {
		var item InventoryAsset
		if err := rows.Scan(&item.ID, &item.AssetNo, &item.Name, &item.DeviceType,
			&item.SourceFamily, &item.ExternalKey, &item.HardwareSN, &item.LifecycleStatus,
			&item.Status, &item.WorkspaceName, &item.ProjectName, &item.SiteName, &item.Address,
			&item.ICCID, &item.InstalledOn, &item.Installer, &item.CustomerOrg, &item.DeliveryProject,
			&item.ContactName, &item.ContactPhone, &item.OpsTags); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "读取设备清单失败", err)
		}
		assets = append(assets, item)
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "读取设备清单失败", err)
	}
	if len(assets) != len(ids) {
		return nil, apperr.New(apperr.KindNotFound, "部分所选设备已不存在，请刷新设备列表后重新导出")
	}
	return assets, nil
}

func (s *Service) loadInventoryNodes(ctx context.Context, assets []InventoryAsset) ([]InventoryNode, error) {
	gateways := make([]uuid.UUID, 0)
	v2Gateways := make([]uuid.UUID, 0)
	byID := make(map[uuid.UUID]InventoryAsset)
	for _, asset := range assets {
		if asset.DeviceType != "gateway" {
			continue
		}
		byID[asset.ID] = asset
		gateways = append(gateways, asset.ID)
		if asset.SourceFamily == "lorawan_v2" {
			v2Gateways = append(v2Gateways, asset.ID)
		}
	}
	nodes := make([]InventoryNode, 0)
	if len(gateways) == 0 {
		return nodes, nil
	}
	rows, err := s.db.Query(ctx, `
		WITH gateways AS (
			SELECT id, ordinal, id = ANY($2::uuid[]) AS v2
			FROM unnest($1::uuid[]) WITH ORDINALITY AS selected(id, ordinal)
		), current_v2_nodes AS (
			SELECT g.id AS gateway_id, g.ordinal, n.node_index, n.asset_no, n.sn
			FROM gateways g JOIN lorawan_physical_nodes n ON n.gateway_device_id = g.id
			WHERE g.v2
			UNION ALL
			SELECT g.id, g.ordinal, l.node_index, '', ''
			FROM gateways g JOIN lorawan_legacy_nodes l ON l.gateway_device_id = g.id
			WHERE g.v2 AND NOT EXISTS (
				SELECT 1 FROM lorawan_physical_nodes n
				WHERE n.gateway_device_id = l.gateway_device_id AND n.node_index = l.node_index
			)
		), nodes AS (
			SELECT n.gateway_id, n.ordinal, n.node_index, n.asset_no, COALESCE(p.name, '') AS name, n.sn
			FROM current_v2_nodes n
			LEFT JOIN node_profiles p ON p.device_id = n.gateway_id AND p.node_index = n.node_index
			UNION ALL
			SELECT g.id, g.ordinal, NULL::integer, COALESCE(d.asset_no, ''), d.name, COALESCE(d.hardware_sn, '')
			FROM gateways g JOIN device_relations r ON r.parent_device_id = g.id
			JOIN devices d ON d.id = r.child_device_id
			WHERE NOT g.v2 AND r.relation_type = 'gateway_node' AND r.status = 'active'
		)
		SELECT gateway_id, node_index, asset_no, name, sn FROM nodes
		ORDER BY ordinal, node_index, name, asset_no`, gateways, v2Gateways)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "读取网关节点清单失败", err)
	}
	defer rows.Close()
	for rows.Next() {
		var gatewayID uuid.UUID
		var item InventoryNode
		if err := rows.Scan(&gatewayID, &item.Index, &item.AssetNo, &item.Name, &item.SN); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "读取网关节点清单失败", err)
		}
		gateway := byID[gatewayID]
		item.GatewayAssetNo, item.GatewayName = gateway.AssetNo, gateway.Name
		if item.Index != nil {
			item.GatewaySN = gateway.ExternalKey
			item.Name = v2NodeName(item.Name, *item.Index)
		} else {
			item.GatewaySN = gateway.HardwareSN
		}
		nodes = append(nodes, item)
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "读取网关节点清单失败", err)
	}
	return nodes, nil
}
