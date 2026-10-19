import type { JsonRecord } from "@thcpn/api";

const text = (value: unknown) => String(value ?? "").trim();
const role = (device: JsonRecord) => text(device.topology_role || device.device_type);

export function configCopyCandidates(target: JsonRecord, devices: JsonRecord[], includeTarget = false): JsonRecord[] {
  const family = text(target.source_family);
  if (!family || !role(target) || !text(target.id)) return [];
  return devices.filter(device =>
    Boolean(text(device.id)) && (includeTarget || device.id !== target.id) &&
    text(device.source_family) === family && role(device) === role(target) &&
    text(device.product_id) === text(target.product_id),
  );
}
