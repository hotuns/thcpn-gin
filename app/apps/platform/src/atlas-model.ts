import type {
  DataStream,
  DeviceMapItem,
  GatewayNode,
  TelemetrySeries,
} from "@thcpn/api";
export type { AtlasConfig } from "@thcpn/api";
import type { AtlasConfig } from "@thcpn/api";
export const ATLAS_TEMPLATE = "atlas-tech";
export const defaultAtlasConfig: AtlasConfig = {
  trend_hours: 24,
  presentation: "technology",
  layout: "balanced",
  show_images: true,
  show_trends: true,
};
export function located(device: Pick<DeviceMapItem, "latitude" | "longitude">) {
  return (
    typeof device.latitude === "number" &&
    typeof device.longitude === "number" &&
    Number.isFinite(device.latitude) &&
    Number.isFinite(device.longitude) &&
    Math.abs(device.latitude) <= 90 &&
    Math.abs(device.longitude) <= 180
  );
}
export function filterDevices(
  items: DeviceMapItem[],
  ids: string[],
  search: string,
  kind: string,
) {
  const q = search.trim().toLocaleLowerCase();
  return items.filter(
    (d) =>
      (!ids.length || ids.includes(d.device_id)) &&
      (kind === "all" || d.device_type === kind) &&
      (!q || `${d.name} ${d.serial_no}`.toLocaleLowerCase().includes(q)),
  );
}
export function streamCatalog(streams: DataStream[], nodes: GatewayNode[]) {
  const map = new Map(
    streams
      .filter((s) => s.status === "active")
      .map((s) => [s.id, { ...s, node: "" }]),
  );
  for (const node of nodes)
    for (const stream of node.streams)
      if (stream.status === "active")
        map.set(stream.id, {
          ...stream,
          device_id:
            node.target.kind === "device"
              ? node.target.device_id
              : node.target.gateway_device_id,
          node: node.name,
        });
  return [...map.values()];
}
export function timeRange(hours: number, now = Date.now()) {
  return {
    start: new Date(now - hours * 3600000).toISOString(),
    end: new Date(now).toISOString(),
  };
}
export function validRange(start: string, end: string) {
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) && duration > 0 && duration <= 30 * 86400000;
}
export function seriesSummary(series?: TelemetrySeries) {
  const points = (series?.points ?? [])
    .filter(
      (p) => Number.isFinite(p.value) && Number.isFinite(Date.parse(p.ts)),
    )
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const values = points.map((p) => p.value);
  return {
    points,
    latest: points.at(-1),
    min: values.length ? Math.min(...values) : undefined,
    max: values.length ? Math.max(...values) : undefined,
    mean: values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : undefined,
  };
}
export const numberLabel = (v?: number) =>
  v == null
    ? "—"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(v);
