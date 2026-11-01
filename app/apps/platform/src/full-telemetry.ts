import { policyLimit } from "./system-policy";
import { api } from "@thcpn/api";

// Split capped responses instead of sampling or silently truncating a chart.
export async function fullTelemetry(deviceId: string, input: Parameters<typeof api.telemetry.device>[1], client = api.telemetry): Promise<Awaited<ReturnType<typeof api.telemetry.device>>> {
  const limit = policyLimit("query_points", 5000);
  const result = await client.device(deviceId, { ...input, adaptive: false, limit });
  if (!result.series.some(series => series.complete === false && !series.error)) return result;
  const start = Date.parse(input.startTime);
  const end = Date.parse(input.endTime);
  if (end - start <= 2000) throw new Error(`已将查询拆分至 2 秒以内，仍无法完整读取数据（每次请求每个指标最多 ${limit.toLocaleString("zh-CN")} 条）。请使用数据导出；若数据量未达上限，请联系管理员检查数据源返回的完整性标记。`);
  const middle = new Date(Math.floor((start + end) / 2000) * 1000).toISOString();
  const left = await fullTelemetry(deviceId, { ...input, endTime: middle }, client);
  const right = await fullTelemetry(deviceId, { ...input, startTime: middle }, client);
  return { ...result, series: left.series.map(series => {
    const other = right.series.find(item => item.data_stream_id === series.data_stream_id);
    if (!other) return series;
    const points = [...new Map([...series.points, ...other.points].map(point => [point.ts, point])).values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    return { ...series, points, sampled: false, returned_count: points.length, source_count: points.length, complete: series.complete && other.complete, error: series.error || other.error, warnings: [...(series.warnings ?? []), ...(other.warnings ?? [])] };
  }) };
}
