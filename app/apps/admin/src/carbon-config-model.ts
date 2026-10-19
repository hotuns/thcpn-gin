import { parseDeviceConfig, type DeviceConfigFields, type JsonRecord } from "@thcpn/api";
import type { ConfigSaveReview } from "./config-save-types";

export const carbonControlFields = [
  { key: "data_capture_invl", label: "数据采集计划" },
  { key: "data_upload_invl", label: "数据上传计划" },
  { key: "image_capture_invl", label: "图片采集计划" },
  { key: "image_upload_invl", label: "图片上传计划" },
  { key: "misc_invl", label: "其他任务计划" },
] as const;

export const isCarbonObject = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonnegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export function parseCarbonConfigContent(fields: Pick<DeviceConfigFields, "data_json" | "image_json" | "control_json">) {
  const data: unknown = JSON.parse(fields.data_json);
  const images: unknown = JSON.parse(fields.image_json);
  const control: unknown = JSON.parse(fields.control_json);
  if (!Array.isArray(data)) throw new Error("Carbon data_json 必须是采集配置数组");
  if (!Array.isArray(images)) throw new Error("Carbon image_json 必须是图片配置数组");
  if (!isCarbonObject(control)) throw new Error("Carbon control_json 必须是控制配置对象");
  return { data: data as unknown[], images: images as unknown[], control };
}

export function validateCarbonConfig(draft: ReturnType<typeof parseCarbonConfigContent>): string[] {
  const errors: string[] = [];
  draft.data.forEach((value, index) => {
    const label = `Carbon 采集项 ${index + 1}`;
    if (!isCarbonObject(value)) { errors.push(`${label} 必须是对象`); return; }
    if (!nonnegativeInteger(value.sensor_id) || value.sensor_id === 0) errors.push(`${label} 的 sensor_id 必须是正整数`);
    if (!nonempty(value.hardware_interface_type)) errors.push(`${label} 缺少 hardware_interface_type（硬件接口类型）`);
    if (!nonempty(value.software_interface_type)) errors.push(`${label} 缺少 software_interface_type（协议类型）`);
    if (!nonnegativeInteger(value.hardware_interface_channel)) errors.push(`${label} 的 hardware_interface_channel 必须是非负整数`);
    const allowed = value.allowed_hardware_interface_channels;
    if (allowed !== undefined && (!Array.isArray(allowed) || !allowed.every(nonnegativeInteger) || !allowed.some(channel => channel === value.hardware_interface_channel))) errors.push(`${label} 的硬件通道不在 allowed_hardware_interface_channels 内`);
    if (!isCarbonObject(value.params)) { errors.push(`${label} 的 params 必须是对象`); return; }
    if (value.params.wait_time !== undefined && !nonnegativeInteger(value.params.wait_time)) errors.push(`${label} 的 params.wait_time 必须是非负整数`);
    if (value.params.contents !== undefined) {
      if (!Array.isArray(value.params.contents)) { errors.push(`${label} 的 params.contents 必须是数组`); return; }
      const keys = new Set<string>();
      value.params.contents.forEach((metric, metricIndex) => {
        if (!isCarbonObject(metric) || !nonempty(metric.key)) errors.push(`${label} 的指标 ${metricIndex + 1} 缺少 key`);
        else if (keys.has(String(metric.key).trim())) errors.push(`${label} 的指标 key “${String(metric.key)}”重复`);
        else keys.add(String(metric.key).trim());
      });
    }
  });
  for (const { key, label } of carbonControlFields) {
    const value = draft.control[key];
    // Both empty and whitespace-only strings occur in native source configs.
    // Validate without rewriting them, so an unrelated edit remains lossless.
    if (value === undefined || typeof value === "string" && !value.trim()) continue;
    if (typeof value !== "string" || !validCarbonSchedule(value)) errors.push(`${label}（${key}）须为空字符串或“分钟列表 小时列表”，例如 0 *`);
  }
  return errors;
}

function validCarbonSchedule(value: string): boolean {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 2) return false;
  return fields.every((field, index) => field === "*" || /^\d{1,2}(,\d{1,2})*$/.test(field) && field.split(",").every(part => Number(part) <= (index === 0 ? 59 : 23)));
}

export function prepareCarbonConfigSave(fields: DeviceConfigFields, original: JsonRecord): ConfigSaveReview {
  const payload = parseDeviceConfig(fields);
  const after = parseCarbonConfigContent(fields);
  const errors = validateCarbonConfig(after);
  if (errors.length) throw new Error(errors.join("；"));
  const before = (original.latest_config ?? {}) as JsonRecord;
  const beforeData = Array.isArray(before.data_json) ? before.data_json : [];
  const beforeImages = Array.isArray(before.image_json) ? before.image_json : [];
  const changes: string[] = [];
  if (JSON.stringify(beforeData) !== JSON.stringify(after.data)) changes.push(`采集配置 ${beforeData.length} → ${after.data.length} 项（按 Carbon 接口和协议字段保存）`);
  if (JSON.stringify(beforeImages) !== JSON.stringify(after.images)) changes.push(`图片配置 ${beforeImages.length} → ${after.images.length} 项`);
  if (JSON.stringify(before.control_json ?? {}) !== JSON.stringify(after.control)) changes.push("Carbon 控制计划已修改");
  return { payload, changes, warnings: [], destructive: after.data.length < beforeData.length || after.images.length < beforeImages.length };
}
