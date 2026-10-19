import type { JsonRecord } from "@thcpn/api";
import { validateSensorWaitTime } from "./sensor-config-wait-time";

export function configurationHistory(input: unknown): JsonRecord[] {
  if (Array.isArray(input)) return input.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!input || typeof input !== "object") return [];
  const value = input as JsonRecord;
  return configurationHistory(value.payload ?? value.data ?? value.items);
}

export function latestGatewayConfiguration(response: unknown): JsonRecord {
  const rows = configurationHistory(response);
  if (!rows.length) throw new Error("来源网关尚未保存配置");
  return [...rows].sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0))[0];
}

export function gatewayConfigCopyDraft(configuration: JsonRecord, targetSN: string): string {
  if (!targetSN.trim()) throw new Error("缺少目标网关 SN，请重新加载设备资料");
  let content = configuration.config_content ?? configuration.content;
  if (typeof content === "string") content = JSON.parse(content);
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("来源网关配置必须是 JSON 对象");
  const draft = structuredClone(content) as JsonRecord;
  if (draft.system !== undefined && (!draft.system || typeof draft.system !== "object" || Array.isArray(draft.system))) throw new Error("来源网关 system 配置必须是 JSON 对象");
  const system = (draft.system ?? {}) as JsonRecord;
  system.did = targetSN.trim();
  delete system.cid;
  draft.system = system;
  return JSON.stringify(draft, null, 2);
}

export function sensorConfigCopyDraft(configuration: JsonRecord) {
  if (!Array.isArray(configuration.content)) throw new Error("来源节点尚无可复制的传感器配置");
  const metrics = configuration.metrics ?? [];
  if (!Array.isArray(metrics)) throw new Error("来源节点指标配置必须是 JSON 数组");
  const waitTime = validateSensorWaitTime(Number(configuration.wait_time ?? 0));
  return { content: JSON.stringify(configuration.content, null, 2), metrics: JSON.stringify(metrics, null, 2), waitTime };
}
