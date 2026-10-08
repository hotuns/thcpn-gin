import { api } from "@thcpn/api";

export async function queryNodeStatus(id: string, input: Parameters<typeof api.telemetry.device>[1]) {
  const recent = await api.telemetry.device(id, { ...input, adaptive: false, limit: 1 });
  // One valid latest record answers the node-level question; no chart is needed.
  if (recent.series.some(series => series.points.length) || recent.series.every(series => series.complete || series.error)) return recent;
  // Sparse/changed metrics must not be reported as absent just because the
  // newest record lacks their keys. Only that node falls back to history.
  return api.telemetry.device(id, { ...input, adaptive: true, targetPoints: 2, limit: 500 });
}
