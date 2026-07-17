import type { JsonRecord } from "./index";

export type THCPNConfigFields = {
  data_json: string;
  image_json: string;
  control_json: string;
};

const pretty = (value: unknown, fallback: unknown) =>
  JSON.stringify(value ?? fallback, null, 2);

export function configFieldsFromDetail(detail: JsonRecord): THCPNConfigFields {
  const latest = (detail.latest_config ?? {}) as JsonRecord;
  return {
    data_json: pretty(latest.data_json, []),
    image_json: pretty(latest.image_json, []),
    control_json: pretty(latest.control_json, {}),
  };
}

export function parseTHCPNConfig(fields: THCPNConfigFields): JsonRecord {
  const data = JSON.parse(fields.data_json);
  const image = JSON.parse(fields.image_json);
  const control = JSON.parse(fields.control_json);
  if (!Array.isArray(data)) throw new Error("data_json 必须是 JSON 数组");
  if (!Array.isArray(image)) throw new Error("image_json 必须是 JSON 数组");
  if (!control || Array.isArray(control) || typeof control !== "object")
    throw new Error("control_json 必须是 JSON 对象");
  return { data_json: data, image_json: image, control_json: control };
}

export function validateConfigField(
  value: unknown,
  expected: "array" | "object",
) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    if (expected === "array" && !Array.isArray(parsed))
      return Promise.reject(new Error("必须填写 JSON 数组，例如 []"));
    if (
      expected === "object" &&
      (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    )
      return Promise.reject(new Error("必须填写 JSON 对象，例如 {}"));
    return Promise.resolve();
  } catch {
    return Promise.reject(new Error("JSON 格式无效，请检查括号、引号和逗号"));
  }
}
