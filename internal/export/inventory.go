package export

import (
	"mime"
	"net/http"
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
		DeviceIDs []uuid.UUID `json:"device_ids"`
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
	assets, nodes, err := h.service.devices.LoadInventory(c.Request.Context(), req.DeviceIDs)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	body, err := renderInventoryXLSX(assets, nodes)
	if err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "生成设备清单失败", err))
		return
	}
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorAdminID: audit.UserActorID(actor.SystemAdministratorID()), Action: "admin.device.inventory.export", ResourceType: "device", Result: audit.ResultSuccess}) {
		return
	}
	filename := "设备清单_" + time.Now().In(exportLocation).Format("2006-01-02") + ".xlsx"
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, contentTypeXLSX, body)
}

func renderInventoryXLSX(assets []device.InventoryAsset, nodes []device.InventoryNode) ([]byte, error) {
	assetRows := make([][]xlsxCell, 1, len(assets)+1)
	assetRows[0] = inventoryTextRow("资产编号", "设备名称", "设备分类", "硬件 SN", "采集设备标识", "生命周期", "启用状态", "工作区", "项目", "站点")
	includeNodes := false
	for _, asset := range assets {
		includeNodes = includeNodes || asset.DeviceType == "gateway"
		assetRows = append(assetRows, inventoryTextRow(asset.AssetNo, asset.Name, inventoryDeviceType(asset), asset.HardwareSN, asset.ExternalKey,
			inventoryLabel(inventoryLifecycleLabels, asset.LifecycleStatus), inventoryLabel(inventoryStatusLabels, asset.Status), asset.WorkspaceName, asset.ProjectName, asset.SiteName))
	}
	sheets := []xlsxSheet{{name: "设备清单", body: xlsxTabularSheet(assetRows, 17, 38, 24, 24, 26, 14, 14, 24, 24, 24)}}
	if includeNodes {
		nodeRows := make([][]xlsxCell, 1, len(nodes)+1)
		nodeRows[0] = inventoryTextRow("网关资产编号", "网关名称", "网关 SN", "节点资产编号", "节点名称", "节点 SN", "序号")
		for _, node := range nodes {
			row := inventoryTextRow(node.GatewayAssetNo, node.GatewayName, node.GatewaySN, node.AssetNo, node.Name, node.SN, "")
			if node.Index != nil {
				row[6] = numberCell(float64(*node.Index))
			}
			nodeRows = append(nodeRows, row)
		}
		sheets = append(sheets, xlsxSheet{name: "网关节点", body: xlsxTabularSheet(nodeRows, 20, 38, 26, 20, 30, 24, 10)})
	}
	return renderXLSX(sheets...)
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

func inventoryTextRow(values ...string) []xlsxCell {
	row := make([]xlsxCell, len(values))
	for i, value := range values {
		row[i] = stringCell(value)
	}
	return row
}
