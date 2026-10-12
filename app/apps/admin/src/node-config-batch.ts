import { api, formatApiError, type JsonRecord } from "@thcpn/api";

export type NodeConfigResult = { node: number; status: "submitting" | "synced" | "sync_failed" | "failed"; detail: string };

export function sensorConfigTargets(current: number, selected: number[], available: number[], applyOthers: boolean): number[] {
  return [...new Set([current, ...(applyOthers ? selected.filter(index => available.includes(index)) : [])])];
}

export async function submitNodeSensorBatch(deviceId: string, targets: number[], payload: JsonRecord, onProgress: (results: NodeConfigResult[]) => void): Promise<NodeConfigResult[]> {
  const results: NodeConfigResult[] = [];
  for (const node of [...new Set(targets)]) {
    onProgress([...results, { node, status: "submitting", detail: "" }]);
    try {
      const result = await api.admin.updateDeviceSourceConfig(deviceId, "sensor", payload, node);
      const state = result.write_state as JsonRecord | undefined;
      const partial = state?.platform === "failed";
      results.push({ node, status: partial ? "sync_failed" : "synced", detail: partial ? "源端已接受，平台同步失败，请重新读取节点配置。" : "源端已接受，平台已同步；设备是否应用尚未确认。" });
    } catch (error) {
      const detail = formatApiError(error);
      results.push({ node, status: "failed", detail: detail.message + (detail.requestId ? " · request id " + detail.requestId : "") });
    }
    onProgress([...results]);
  }
  return results;
}
