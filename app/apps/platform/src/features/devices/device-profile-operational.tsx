import { GatewayReportedDetails } from "./lorawan-data-view";
import { useQuery } from "@tanstack/react-query";
import { Clock3, DatabaseZap, Gauge } from "lucide-react";
import { api, deviceCapabilityLabel, formatApiError, type Device } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Panel, StateView } from "../../shared/ui";
import { deviceCategory, overviewTime, text, sourceDeviceStatus } from "./device-model";
import { DeviceVitalIndicators } from "./device-vital-indicators";

export function DeviceProfileOperational({ device, workspaceId }: { device: Device; workspaceId: string }) {
  const carbonDevice = deviceCategory(device) === "carbon_sink";
  const latestAttributes = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", device.id, "latest-attributes"),
    queryFn: () => api.devices.latestAttributes(device.id),
    enabled: device.source_family === "thcpn",
  });
  const carbonOverview = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", device.id, "carbon-overview"),
    queryFn: () => api.carbon.overview(device.id),
    enabled: carbonDevice,
  });
  if (device.source_family === "lorawan_v2") return <><GatewayReportedDetails deviceId={device.id} workspaceId={workspaceId} location/><Panel><div className="panel-header"><h3>设备接入</h3><Badge tone={device.source_status === "active" ? "success" : "warning"}>{device.source_status === "active" ? "已启用" : "已停用"}</Badge></div><p>LoRaWAN V2 组网站 · {device.child_count} 个节点</p></Panel></>;
  return <div className="device-profile-operational">
    <section className="device-profile-runtime-summary">
      <div className="device-profile-section-heading"><div><h3><Gauge size={16} />运行概况</h3><span>能力与设备最新状态</span></div><span title={`最近更新 ${overviewTime(device.updated_at)}`}><Clock3 size={14} aria-hidden="true" />{overviewTime(device.updated_at)}</span></div>
      <div className="device-overview-summary">
        <div className="device-detail-capabilities device-overview-capabilities">{device.capabilities.length ? device.capabilities.map((item) => <span key={item} title={item}><Badge tone="info">{deviceCapabilityLabel(item)}</Badge></span>) : <span className="muted">未声明设备能力</span>}</div>
        <DeviceVitalIndicators attributes={latestAttributes.data?.attributes} loading={!carbonDevice && latestAttributes.isLoading} csq={deviceCategory(device) === "standalone"} lithiumVoltage={device.source_family === "thcpn" && ["gateway", "gateway_node"].includes(deviceCategory(device))} />
      </div>
    </section>
    <section className="device-source-runtime">
      <div className="device-profile-section-heading"><div><h3><DatabaseZap size={16} />源设备</h3><span>{carbonDevice ? "碳汇源库状态" : "THCPN 实时状态"}</span></div></div>
      {carbonDevice ? carbonOverview.isLoading ? <StateView type="loading" title="正在读取碳汇源库" description="" /> : carbonOverview.error ? <StateView type="error" title="碳汇源库状态不可用" description={formatApiError(carbonOverview.error).message} /> : carbonOverview.data ? <dl className="device-source-runtime-grid"><div><dt>电池</dt><dd>{carbonOverview.data.runtime?.battery ? `${carbonOverview.data.runtime.battery}%` : "—"}</dd></div><div><dt>信号</dt><dd>{text(carbonOverview.data.runtime?.signal)}</dd></div><div><dt>网络</dt><dd>{text(carbonOverview.data.runtime?.network)}</dd></div><div><dt>源库更新时间</dt><dd>{overviewTime(carbonOverview.data.refreshed_at)}</dd></div></dl> : <StateView type="empty" title="暂无碳汇源库状态" description="当前设备没有可读取的源库运行信息。" /> : latestAttributes.isLoading ? <StateView type="loading" title="正在读取源设备" description="" /> : latestAttributes.error ? <StateView type="error" title="源设备状态不可用" description={formatApiError(latestAttributes.error).message} /> : latestAttributes.data?.source_device ? <dl className="device-source-runtime-grid"><div><dt>运行状态</dt><dd>{sourceDeviceStatus(latestAttributes.data.source_device)}</dd></div><div><dt>当前版本</dt><dd>{text(latestAttributes.data.source_device.current_device_version ?? latestAttributes.data.source_device.version)}</dd></div><div><dt>源库更新时间</dt><dd>{overviewTime(latestAttributes.data.source_device.updated_at)}</dd></div></dl> : <StateView type="empty" title="暂无源设备状态" description="当前设备没有可读取的源库运行信息。" />}
    </section>
  </div>;
}
