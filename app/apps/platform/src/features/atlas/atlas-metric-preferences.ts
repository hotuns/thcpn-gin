import { isMeasurement, type DataStream } from "@thcpn/api";

export const ATLAS_METRIC_LIMIT = 6;
export function defaultMetricIds(metrics: DataStream[], codes?: string[], legacyIds?: string[]) {
  const ids = codes !== undefined
    ? codes.flatMap(code => metrics.filter(stream => stream.code === code).map(stream => stream.id))
    : legacyIds?.filter(id => metrics.some(stream => stream.id === id));
  return [...new Set(ids?.length || codes !== undefined ? ids : metrics.filter(isMeasurement).slice(0, 4).map(stream => stream.id))].slice(0, ATLAS_METRIC_LIMIT);
}
export function preferenceKey(user: string, workspace: string, board: string, device: string, node: string) {
  return `atlas-metrics:${JSON.stringify([user, workspace, board, device, node])}`;
}
export function readMetricPreference(key: string): string[] | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(value) && value.every(id => typeof id === "string")
      ? [...new Set(value)].slice(0, ATLAS_METRIC_LIMIT) : null;
  } catch { return null; }
}
