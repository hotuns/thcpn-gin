import type { DataStream, GatewayNode, JsonRecord, TelemetrySeries } from "@thcpn/api";

export const opsTime = (input?: string) => input ? new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(input)) : "—";

export function operationsStreams(streams: DataStream[], nodes: GatewayNode[], selected?: GatewayNode) {
  if (selected) return selected.streams.filter(stream=>stream.type==="telemetry" && stream.status==="active");
  const childStreams = new Set(nodes.flatMap(node=>node.streams.map(stream=>stream.id)));
  return streams.filter(stream=>stream.type==="telemetry" && stream.status==="active" && !childStreams.has(stream.id));
}

export function telemetryRows(series: TelemetrySeries[]) {
  const rows = new Map<string, {key:string;timestamp:string;[key:string]:string|number}>();
  for (const stream of series) for (const point of stream.points) {
    const ms=Date.parse(point.ts);
    if (!Number.isFinite(ms)) continue;
    const key=new Date(ms).toISOString();
    const row=rows.get(key) ?? {key,timestamp:key};
    row[stream.data_stream_id]=point.value;
    rows.set(key,row);
  }
  return [...rows.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
}

export type OpsExportOptions = {
  start:string;end:string;format:"zip"|"telemetry_excel"|"telemetry_csv"|"media_zip";
  data:boolean;images:boolean;nodes:GatewayNode[];carbonNodes:number[];fields:string[];
};

export function operationsExportPayload(device:JsonRecord, options:OpsExportOptions): JsonRecord {
  const id=String(device.id ?? "");
  if (!id || !Number.isFinite(Date.parse(options.start)) || !(Date.parse(options.end)>Date.parse(options.start))) throw new Error("请选择设备和有效时间范围");
  const config:JsonRecord={start_time:options.start,end_time:options.end};
  if (device.device_type==="carbon_sink") {
    if (!options.carbonNodes.length || !options.fields.length || (!options.data && !options.images)) throw new Error("请选择 Node、地块及导出内容");
    return {resource_type:"device",resource_id:id,export_type:"carbon_station_zip",request_config:{...config,node_ids:options.carbonNodes,fields:options.fields,include_flux:options.data,include_raw_samples:options.images}};
  }
  if (options.format!=="zip") return {resource_type:"device",resource_id:id,export_type:options.format,request_config:config};
  if (!options.data && !options.images) throw new Error("至少选择数据或图片");
  if (device.device_type==="gateway") {
    if (!options.nodes.length) throw new Error("请选择导出节点");
    if (device.source_family==="lorawan_v2" && options.images) throw new Error("LoRa V2 节点不支持图片导出");
    const ids=[...new Set(options.nodes.map(node=>node.target.kind==="device" ? node.target.device_id : node.target.gateway_device_id))];
    return {resource_type:"device_batch",resource_id:ids[0],export_type:"group_site_zip",request_config:{...config,gateway_id:id,gateway_name:device.name,device_ids:ids,node_targets:options.nodes.map(node=>node.target),include_data:options.data,include_images:options.images}};
  }
  if (device.device_type!=="standalone") throw new Error("该设备请选择 Excel、CSV 或图片包导出");
  return {resource_type:"device_batch",resource_id:id,export_type:"standard_station_zip",request_config:{...config,device_ids:[id],include_data:options.data,include_images:options.images}};
}
