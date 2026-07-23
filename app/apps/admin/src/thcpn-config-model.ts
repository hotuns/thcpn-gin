import type { JsonRecord } from "@thcpn/api";

export type THCPNConfigDraft = {
  sensors: JsonRecord[];
  images: JsonRecord[];
  control: JsonRecord;
  expectedConfigId: number;
};

export type ConfigChangeSummary = {
  sensorsAdded: number;
  sensorsRemoved: number;
  metricsBefore: number;
  metricsAfter: number;
  metricsChanged: boolean;
  imagesAdded: number;
  imagesRemoved: number;
  controlChanged: boolean;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function configDraftFromDetail(detail: JsonRecord): THCPNConfigDraft {
  const latest = (detail.latest_config ?? {}) as JsonRecord;
  return {
    sensors: Array.isArray(latest.data_json) ? clone(latest.data_json as JsonRecord[]) : [],
    images: Array.isArray(latest.image_json) ? clone(latest.image_json as JsonRecord[]) : [],
    control: latest.control_json && typeof latest.control_json === "object" && !Array.isArray(latest.control_json)
      ? clone(latest.control_json as JsonRecord)
      : {},
    expectedConfigId: Number(latest.id ?? 0),
  };
}

export function parseAdvancedConfig(input: { data: string; image: string; control: string }, expectedConfigId: number): THCPNConfigDraft {
  const sensors = JSON.parse(input.data);
  const images = JSON.parse(input.image);
  const control = JSON.parse(input.control);
  if (!Array.isArray(sensors)) throw new Error("数据通道必须是 JSON 数组");
  if (!Array.isArray(images)) throw new Error("图片通道必须是 JSON 数组");
  if (!control || Array.isArray(control) || typeof control !== "object") throw new Error("控制配置必须是 JSON 对象");
  return { sensors, images, control, expectedConfigId };
}

export function advancedConfigFromDraft(draft: THCPNConfigDraft) {
  return {
    data: JSON.stringify(draft.sensors, null, 2),
    image: JSON.stringify(draft.images, null, 2),
    control: JSON.stringify(draft.control, null, 2),
  };
}

export function configPayloadFromDraft(draft: THCPNConfigDraft): JsonRecord {
  return {
    data_json: clone(draft.sensors),
    image_json: clone(draft.images),
    control_json: clone(draft.control),
    expected_config_id: draft.expectedConfigId,
  };
}

export function sensorMetrics(sensor: JsonRecord): JsonRecord[] {
  const params = (sensor.params ?? {}) as JsonRecord;
  return Array.isArray(params.contents) ? params.contents as JsonRecord[] : [];
}

export function duplicateSensorWarnings(sensors: JsonRecord[]): string[] {
  const seen = new Map<string, number>();
  const warnings: string[] = [];
  sensors.forEach((sensor, index) => {
    const params = (sensor.params ?? {}) as JsonRecord;
    const command = String(params.command ?? "").trim().toLowerCase();
    if (!command) return;
    const key = [sensor.port, sensor.sensor, sensor.port_num, command].map((item) => String(item ?? "").trim().toLowerCase()).join("|");
    const previous = seen.get(key);
    if (previous !== undefined) warnings.push(`传感器 ${previous + 1} 与 ${index + 1} 使用相同端口、驱动和命令`);
    else seen.set(key, index);
  });
  return warnings;
}

export function validateVisualConfig(draft: THCPNConfigDraft): string[] {
  const errors: string[] = [];
  const imageKeys = new Set<string>();
  draft.sensors.forEach((sensor, index) => {
    if (!String(sensor.sensorType ?? "").trim()) errors.push(`传感器 ${index + 1} 缺少型号`);
    if (!String(sensor.port ?? "").trim()) errors.push(`传感器 ${index + 1} 缺少端口`);
    const metrics = sensorMetrics(sensor);
    const keys = new Set<string>();
    metrics.forEach((metric, metricIndex) => {
      const key = String(metric.key ?? "").trim();
      if (!key) errors.push(`传感器 ${index + 1} 的指标 ${metricIndex + 1} 缺少 key`);
      else if (keys.has(key)) errors.push(`传感器 ${index + 1} 的指标 key “${key}”重复`);
      else keys.add(key);
    });
  });
  draft.images.forEach((image, index) => {
    const key = String(image.key ?? "").trim();
    if (!key) errors.push(`图片通道 ${index + 1} 缺少 key`);
    else if (imageKeys.has(key)) errors.push(`图片通道 key “${key}”重复`);
    else imageKeys.add(key);
  });
  if (draft.expectedConfigId <= 0) errors.push("缺少源配置版本，请重新加载");
  return errors;
}

export type ParsedSchedule = { minutes: number[]; hours: number[]; wildcardHours: boolean; valid: boolean };

export function parseTwoFieldSchedule(input: unknown): ParsedSchedule {
  const parts = String(input ?? "").trim().split(/\s+/);
  if (parts.length !== 2) return { minutes: [], hours: [], wildcardHours: false, valid: false };
  const minutes = parseNumberList(parts[0], 0, 59);
  const wildcardHours = parts[1] === "*";
  const hours = wildcardHours ? [] : parseNumberList(parts[1], 0, 23);
  return { minutes: minutes ?? [], hours: hours ?? [], wildcardHours, valid: Boolean(minutes && (wildcardHours || hours)) };
}

export function formatTwoFieldSchedule(minutes: number[], hours: number[], wildcardHours: boolean): string {
  return `${normalizeNumbers(minutes).join(",")} ${wildcardHours ? "*" : normalizeNumbers(hours).join(",")}`;
}

function parseNumberList(input: string, min: number, max: number): number[] | null {
  if (!input) return null;
  const values = input.split(",").map((item) => Number(item.trim()));
  if (!values.length || values.some((item) => !Number.isInteger(item) || item < min || item > max)) return null;
  return normalizeNumbers(values);
}

function normalizeNumbers(values: number[]) {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function configChangeSummary(before: THCPNConfigDraft, after: THCPNConfigDraft): ConfigChangeSummary {
  const sensorChanges = multisetChanges(before.sensors.map(sensorSignature), after.sensors.map(sensorSignature));
  const imageChanges = multisetChanges(before.images.map(imageSignature), after.images.map(imageSignature));
  return {
    sensorsAdded: sensorChanges.added,
    sensorsRemoved: sensorChanges.removed,
    metricsBefore: before.sensors.reduce((total, sensor) => total + sensorMetrics(sensor).length, 0),
    metricsAfter: after.sensors.reduce((total, sensor) => total + sensorMetrics(sensor).length, 0),
    metricsChanged: JSON.stringify(before.sensors.map(sensorMetrics)) !== JSON.stringify(after.sensors.map(sensorMetrics)),
    imagesAdded: imageChanges.added,
    imagesRemoved: imageChanges.removed,
    controlChanged: JSON.stringify(before.control) !== JSON.stringify(after.control),
  };
}

function sensorSignature(sensor: JsonRecord) {
  const params = (sensor.params ?? {}) as JsonRecord;
  return [sensor.sensorType, sensor.sensor, sensor.port, sensor.port_num, params.command].map((item) => String(item ?? "")).join("|");
}

function imageSignature(image: JsonRecord) {
  return [image.key, image.sensorType, image.port, image.port_num].map((item) => String(item ?? "")).join("|");
}

function multisetChanges(before: string[], after: string[]) {
  const counts = new Map<string, number>();
  before.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
  let added = 0;
  after.forEach((item) => {
    const remaining = counts.get(item) ?? 0;
    if (remaining > 0) counts.set(item, remaining - 1);
    else added += 1;
  });
  const removed = Array.from(counts.values()).reduce((total, count) => total + count, 0);
  return { added, removed };
}

export function cloneConfigValue<T>(value: T): T {
  return clone(value);
}
