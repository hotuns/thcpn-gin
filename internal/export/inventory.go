package export

import (
	"fmt"
	"mime"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/httpx"
)

const maxInventoryDevices = 10_000

func (h *Handler) AdminDownloadDeviceInventory(c *gin.Context) {
	actor, ok := adminActor(c)
	if !ok {
		return
	}
	var req struct {
		DeviceIDs  []uuid.UUID `json:"device_ids"`
		Fields     []string    `json:"fields"`
		NodeFields []string    `json:"node_fields"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.DeviceIDs) == 0 || len(req.DeviceIDs) > maxInventoryDevices {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "请选择 1 至 10000 台设备导出"))
		return
	}
	seen := make(map[uuid.UUID]struct{}, len(req.DeviceIDs))
	for _, id := range req.DeviceIDs {
		_, duplicated := seen[id]
		if id == uuid.Nil || duplicated {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "所选设备无效或重复，请刷新列表后重新选择"))
			return
		}
		seen[id] = struct{}{}
	}
	assetColumns, err := resolveInventoryColumns(req.Fields, defaultInventoryFields, inventoryFields, "设备清单")
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if len(assetColumns) == 0 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "请至少选择一项设备字段"))
		return
	}
	nodeColumns, err := resolveInventoryColumns(req.NodeFields, defaultInventoryNodeFields, inventoryNodeFields, "网关节点")
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	ctx := c.Request.Context()
	assets, nodes, err := h.service.devices.LoadInventory(ctx, req.DeviceIDs, len(nodeColumns) > 0)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	var codes map[uuid.UUID]string
	var auditReason string
	if slices.Contains(req.Fields, "binding_code") {
		if h.claims == nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "绑定码服务未配置"))
			return
		}
		codes, err = h.claims.ListExistingManualCodes(ctx, req.DeviceIDs)
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		auditReason = fmt.Sprintf("已选择导出设备绑定码，%d 台设备有绑定码", len(codes))
	}
	body, err := renderInventoryXLSX(assets, nodes, assetColumns, nodeColumns, codes)
	if err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "生成设备清单失败", err))
		return
	}
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorAdminID: audit.UserActorID(actor.SystemAdministratorID()), Action: "admin.device.inventory.export", ResourceType: "device", Result: audit.ResultSuccess, Reason: auditReason}) {
		return
	}
	filename := "设备清单_" + time.Now().In(exportLocation).Format("2006-01-02") + ".xlsx"
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, contentTypeXLSX, body)
}

func renderInventoryXLSX(assets []device.InventoryAsset, nodes []device.InventoryNode, assetColumns []inventoryColumn[inventoryAssetRow], nodeColumns []inventoryColumn[device.InventoryNode], codes map[uuid.UUID]string) ([]byte, error) {
	assetRows := make([]inventoryAssetRow, 0, len(assets))
	includeNodes := false
	for _, asset := range assets {
		includeNodes = includeNodes || asset.DeviceType == "gateway"
		assetRows = append(assetRows, inventoryAssetRow{InventoryAsset: asset, bindingCode: codes[asset.ID]})
	}
	sheets := []xlsxSheet{inventorySheet("设备清单", assetColumns, assetRows)}
	if includeNodes && len(nodeColumns) != 0 {
		sheets = append(sheets, inventorySheet("网关节点", nodeColumns, nodes))
	}
	return renderXLSX(sheets...)
}

type inventoryAssetRow struct {
	device.InventoryAsset
	bindingCode string
}

type inventoryColumn[T any] struct {
	label string
	width int
	cell  func(T) xlsxCell
}

func inventoryTextColumn[T any](label string, width int, value func(T) string) inventoryColumn[T] {
	return inventoryColumn[T]{label, width, func(row T) xlsxCell { return stringCell(value(row)) }}
}

var defaultInventoryFields = []string{
	"asset_no", "name", "device_type", "hardware_sn", "collection_id", "lifecycle_status", "status", "workspace", "project", "site",
}

var inventoryFields = map[string]inventoryColumn[inventoryAssetRow]{
	"asset_no":      inventoryTextColumn("资产编号", 17, func(row inventoryAssetRow) string { return row.AssetNo }),
	"name":          inventoryTextColumn("设备名称", 38, func(row inventoryAssetRow) string { return row.Name }),
	"device_type":   inventoryTextColumn("设备分类", 24, func(row inventoryAssetRow) string { return inventoryDeviceType(row.InventoryAsset) }),
	"hardware_sn":   inventoryTextColumn("硬件 SN", 24, func(row inventoryAssetRow) string { return row.HardwareSN }),
	"collection_id": inventoryTextColumn("采集设备标识", 26, func(row inventoryAssetRow) string { return row.ExternalKey }),
	"gateway_sn": inventoryTextColumn("网关 SN", 26, func(row inventoryAssetRow) string {
		if row.DeviceType == "gateway" && row.SourceFamily == "lorawan_v2" {
			return row.ExternalKey
		}
		return ""
	}),
	"lifecycle_status": inventoryTextColumn("生命周期", 14, func(row inventoryAssetRow) string {
		return inventoryLabel(inventoryLifecycleLabels, row.LifecycleStatus)
	}),
	"status":           inventoryTextColumn("启用状态", 14, func(row inventoryAssetRow) string { return inventoryLabel(inventoryStatusLabels, row.Status) }),
	"workspace":        inventoryTextColumn("工作区", 24, func(row inventoryAssetRow) string { return row.WorkspaceName }),
	"project":          inventoryTextColumn("项目", 24, func(row inventoryAssetRow) string { return row.ProjectName }),
	"site":             inventoryTextColumn("站点", 24, func(row inventoryAssetRow) string { return row.SiteName }),
	"binding_code":     inventoryTextColumn("绑定码", 18, func(row inventoryAssetRow) string { return row.bindingCode }),
	"address":          inventoryTextColumn("安装地址", 48, func(row inventoryAssetRow) string { return row.Address }),
	"iccid":            inventoryTextColumn("登记 ICCID", 26, func(row inventoryAssetRow) string { return row.ICCID }),
	"installed_on":     inventoryTextColumn("安装日期", 16, func(row inventoryAssetRow) string { return row.InstalledOn }),
	"installer":        inventoryTextColumn("安装人", 23, func(row inventoryAssetRow) string { return row.Installer }),
	"customer_org":     inventoryTextColumn("所属单位", 32, func(row inventoryAssetRow) string { return row.CustomerOrg }),
	"delivery_project": inventoryTextColumn("交付项目名称", 32, func(row inventoryAssetRow) string { return row.DeliveryProject }),
	"contact_name":     inventoryTextColumn("联系人", 23, func(row inventoryAssetRow) string { return row.ContactName }),
	"contact_phone":    inventoryTextColumn("联系电话", 22, func(row inventoryAssetRow) string { return row.ContactPhone }),
	"ops_tags":         inventoryTextColumn("运维标签", 34, func(row inventoryAssetRow) string { return row.OpsTags }),
}

var defaultInventoryNodeFields = []string{"gateway_asset_no", "gateway_name", "gateway_sn", "asset_no", "name", "node_sn", "node_index"}

var inventoryNodeFields = map[string]inventoryColumn[device.InventoryNode]{
	"gateway_asset_no": inventoryTextColumn("网关资产编号", 20, func(row device.InventoryNode) string { return row.GatewayAssetNo }),
	"gateway_name":     inventoryTextColumn("网关名称", 38, func(row device.InventoryNode) string { return row.GatewayName }),
	"gateway_sn":       inventoryTextColumn("网关 SN", 26, func(row device.InventoryNode) string { return row.GatewaySN }),
	"asset_no":         inventoryTextColumn("节点资产编号", 20, func(row device.InventoryNode) string { return row.AssetNo }),
	"name":             inventoryTextColumn("节点名称", 30, func(row device.InventoryNode) string { return row.Name }),
	"node_sn":          inventoryTextColumn("节点 SN", 24, func(row device.InventoryNode) string { return row.SN }),
	"node_index": {"序号", 10, func(row device.InventoryNode) xlsxCell {
		if row.Index == nil {
			return stringCell("")
		}
		return numberCell(float64(*row.Index))
	}},
}

func resolveInventoryColumns[T any](requested, defaults []string, available map[string]inventoryColumn[T], sheet string) ([]inventoryColumn[T], error) {
	if requested == nil {
		requested = defaults
	}
	columns := make([]inventoryColumn[T], 0, len(requested))
	seen := make(map[string]bool)
	for _, key := range requested {
		column, ok := available[key]
		if !ok || seen[key] {
			return nil, apperr.New(apperr.KindInvalidArgument, sheet+"含无效或重复的导出字段")
		}
		seen[key] = true
		columns = append(columns, column)
	}
	return columns, nil
}

func inventorySheet[T any](name string, columns []inventoryColumn[T], data []T) xlsxSheet {
	rows := make([][]xlsxCell, 1, len(data)+1)
	rows[0] = make([]xlsxCell, len(columns))
	widths := make([]int, len(columns))
	for i, column := range columns {
		rows[0][i] = stringCell(column.label)
		widths[i] = column.width
	}
	for _, item := range data {
		row := make([]xlsxCell, len(columns))
		for i, column := range columns {
			row[i] = column.cell(item)
		}
		rows = append(rows, row)
	}
	return xlsxSheet{name: name, body: xlsxTabularSheet(rows, widths...)}
}

var inventoryDeviceLabels = map[string]string{
	"standalone": "标准站", "gateway": "THCPN 组网站", "gateway_node": "THCPN 组网节点", "carbon_sink": "碳汇站", "camera": "视频站",
}
var inventoryLifecycleLabels = map[string]string{
	"inbound": "待安装", "installed": "已安装", "online": "运行中", "maintenance": "维护中", "repairing": "维修中", "retired": "已退役",
}
var inventoryStatusLabels = map[string]string{"active": "启用", "disabled": "停用", "retired": "已退役"}

func inventoryDeviceType(asset device.InventoryAsset) string {
	if asset.DeviceType == "gateway" && asset.SourceFamily == "lorawan_v2" {
		return "LoRaWAN V2 网关"
	}
	return inventoryLabel(inventoryDeviceLabels, asset.DeviceType)
}

func inventoryLabel(labels map[string]string, code string) string {
	if value, ok := labels[code]; ok {
		return value
	}
	return code
}
