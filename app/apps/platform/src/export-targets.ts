import type { ExportJob, JsonRecord } from "@thcpn/api";

export type ExportTarget = { key: string; name: string; description: string };
type TargetJob = Pick<ExportJob, "export_type" | "resource_type" | "resource_id" | "request_config">;
const strings = (input: unknown): string[] => Array.isArray(input) ? input.map(String) : [];

export function resolveExportTargets(job: TargetJob, devices: JsonRecord[]) {
  const config = (job.request_config ?? {}) as JsonRecord;
  const byId = new Map(devices.map(device => [String(device.id), device]));
  const names = (config.node_names ?? {}) as Record<string, string>;
  const deviceTarget = (id: string, savedName?: string): ExportTarget => {
    const device = byId.get(id);
    return {
      key: id,
      name: savedName || String(device?.name || "设备名称暂不可用"),
      description: device?.serial_no ? `SN ${device.serial_no}` : `设备 ID ${id}`,
    };
  };
  const gatewayId = String(config.gateway_id || "");
  const gateway = gatewayId ? deviceTarget(gatewayId, String(config.gateway_name || "")) : undefined;
  const nodeTargets = Array.isArray(config.node_targets) ? config.node_targets as JsonRecord[] : [];
  let items: ExportTarget[];
  if (nodeTargets.length) {
    items = nodeTargets.map(target => {
      if (target.kind === "device") {
        const id = String(target.device_id);
        return deviceTarget(id, names[`device:${id}`] || names[id]);
      }
      const key = `gateway:${target.gateway_device_id}:node:${target.node_index}`;
      return { key, name: names[key] || `节点 ${target.node_index}`, description: `节点 ${target.node_index}` };
    });
  } else if (job.export_type === "carbon_station_zip") {
    items = strings(config.node_ids).map(index => ({ key: index, name: names[index] || `Node ${index}`, description: `Node ${index}` }));
  } else if (job.resource_type === "dataset") {
    items = [{ key: job.resource_id, name: String(config.dataset_name || "数据集"), description: `数据集 ID ${job.resource_id}` }];
  } else if (job.resource_type === "data_stream" || job.resource_type === "media") {
    items = [{ key: job.resource_id, name: String(config.data_stream_name || "数据通道"), description: `通道 ID ${job.resource_id}` }];
  } else {
    const ids = strings(config.device_ids);
    items = (ids.length ? ids : [job.resource_id]).map(id => deviceTarget(id, names[`device:${id}`] || names[id]));
  }
  const station = job.export_type === "carbon_station_zip" ? deviceTarget(job.resource_id) : gateway;
  const countLabel = job.export_type === "carbon_station_zip"
    ? `${items.length} 个 Node · ${strings(config.fields).length} 个地块`
    : job.export_type === "group_site_zip" ? `${items.length} 个节点`
    : job.resource_type === "dataset" ? "1 个数据集"
    : job.resource_type === "data_stream" || job.resource_type === "media" ? "1 个数据通道"
    : `${items.length} 台设备`;
  return { station, items, countLabel, fields: strings(config.fields) };
}
