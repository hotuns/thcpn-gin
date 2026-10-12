import { api, formatApiError, type JsonRecord } from "@thcpn/api";

export type NodeConfigResult = { node: number; status: "submitting" | "synced" | "sync_failed" | "failed"; detail: string };

export function sensorConfigTargets(current: number, selected: number[], available: number[], applyOthers: boolean): number[] {
  return [...new Set([current, ...(applyOthers ? selected.filter(index => available.includes(index)) : [])])];
}

export async function submitNodeSensorBatch(deviceId: string, targets: number[], payload: JsonRecord, onProgress: (results: NodeConfigResult[]) => void): Promise<NodeConfigResult[]> {
  const nodes = [...new Set(targets)];
  const results: (NodeConfigResult | undefined)[] = new Array(nodes.length);
  const report = () => onProgress(results.filter((item): item is NodeConfigResult => item !== undefined).map(item => ({ ...item })));
  let next = 0;
  const worker = async () => {
    while (next < nodes.length) {
      const index = next++;
      const node = nodes[index];
      results[index] = { node, status: "submitting", detail: "" };
      report();
      try {
        const result = await api.admin.updateDeviceSourceConfig(deviceId, "sensor", payload, node);
        const state = result.write_state as JsonRecord | undefined;
        const partial = state?.platform === "failed";
        results[index] = { node, status: partial ? "sync_failed" : "synced", detail: partial ? "源端已接受，平台同步失败，请重新读取节点配置。" : "源端已接受，平台已同步；设备是否应用尚未确认。" };
      } catch (error) {
        const detail = formatApiError(error);
        results[index] = { node, status: "failed", detail: detail.message + (detail.requestId ? " · request id " + detail.requestId : "") };
      }
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, nodes.length) }, worker));
  return results.filter((item): item is NodeConfigResult => item !== undefined);
}
