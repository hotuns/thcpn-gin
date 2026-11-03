import { deviceTopologyRoleLabel, type Device, type DeviceTaxonomyTerm, type JsonRecord, type THCPNLatestAttributesResponse } from "@thcpn/api";

export type DeviceCategory = "gateway" | "gateway_node" | "camera" | "carbon_sink" | "standalone";

type VitalLevel = "good" | "fair" | "low" | "critical" | "unknown";

type VitalReading = {
  level: VitalLevel;
  valueLabel: string;
  description: string;
};

export const text = (input: unknown, fallback: unknown = "—") =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);

export const overviewTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(input))
    : "—";

export const deviceCategory = (
  device: Pick<Device, "topology_role" | "device_type">,
): DeviceCategory => {
  const role = String(device.topology_role || device.device_type);
  return role === "gateway" || role === "gateway_node" || role === "camera" || role === "carbon_sink"
    ? role
    : "standalone";
};

export const isTopLevelDevice = (
  device: Pick<Device, "topology_role" | "device_type">,
) => deviceCategory(device) !== "gateway_node";

export const matchesDeviceType = (
  selectedTypeId: string,
  deviceType?: Pick<DeviceTaxonomyTerm, "id">,
) => !selectedTypeId || deviceType?.id === selectedTypeId;

export const deviceModelLabel = (device: Pick<Device, "device_type" | "source_family">) =>
  device.device_type === "gateway"
    ? device.source_family === "lorawan_v2"
      ? "LoRa V2 网关"
      : "THCPN 组网站网关"
    : deviceTopologyRoleLabel(device.device_type);

export const numericAttributeValue = (
  attribute?: THCPNLatestAttributesResponse["attributes"][string],
) => {
  const value = attribute?.parsed_value ?? attribute?.raw_value;
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const csqSignalBars = (value: number | null): number | null => {
  if (value === null || !Number.isInteger(value) || value < 0 || value > 31) return null;
  return value === 0 ? 0 : value < 10 ? 1 : value < 15 ? 2 : value < 20 ? 3 : 4;
};

export const inferSignalReading = (value: number | null, csq = false): VitalReading => {
  if (csq) {
    if (value === 99) return { level: "unknown", valueLabel: "未知", description: "信号未知 / 未检测到网络（CSQ 99）" };
    if (value === null || !Number.isInteger(value) || value < 0 || value > 31)
      return { level: "unknown", valueLabel: "—", description: "暂无有效 CSQ 信号数据" };
    return {
      level: value >= 20 ? "good" : value >= 15 ? "fair" : value >= 10 ? "low" : "critical",
      valueLabel: `CSQ ${value}`,
      description: `CSQ ${value} / 31`,
    };
  }
  if (value === null || value < 0)
    return { level: "unknown", valueLabel: "—", description: "暂无信号数据" };
  const normalized = Math.min(100, Math.round(value));
  const level: VitalLevel =
    normalized >= 70
      ? "good"
      : normalized >= 40
        ? "fair"
        : normalized >= 20
          ? "low"
          : "critical";
  return {
    level,
    valueLabel: `${normalized}%`,
    description: `信号 ${normalized}%（暂按 70/40/20 分级）`,
  };
};

export const leadAcidBatteryLevel = (value: number | null): VitalLevel => {
  if (value === null || !Number.isFinite(value) || value <= 0) return "unknown";
  return value <= 11.3 ? "critical" : value < 12 ? "low" : value < 12.6 ? "fair" : "good";
};

export const inferBatteryReading = (value: number | null, leadAcid = false, lithiumVoltage = false): VitalReading => {
  if (lithiumVoltage) {
    if (value === null || !Number.isFinite(value) || value <= 0) return { level: "unknown", valueLabel: "—", description: "暂无电量数据" };
    return { level: "unknown", valueLabel: `${value.toFixed(2)}V`, description: `${value.toFixed(2)}V（仅显示电压，电量分档待确认）` };
  }
  if (leadAcid) {
    const level = leadAcidBatteryLevel(value);
    return level === "unknown"
      ? { level, valueLabel: "—", description: "暂无电量数据" }
      : { level, valueLabel: `${value!.toFixed(2)}V`, description: `${value!.toFixed(2)}V（电压分档，非精确剩余电量）` };
  }
  if (value === null || value < 0)
    return { level: "unknown", valueLabel: "—", description: "暂无电量数据" };
  if (value >= 8 && value <= 16) {
    const level: VitalLevel =
      value >= 12.4
        ? "good"
        : value >= 12
          ? "fair"
          : value >= 11.5
            ? "low"
            : "critical";
    return {
      level,
      valueLabel: `${value.toFixed(1)}V`,
      description: `电池 ${value.toFixed(2)}V（暂按 12V 电池推测）`,
    };
  }
  if (value > 0 && value <= 5.5) {
    const level: VitalLevel =
      value >= 3.8
        ? "good"
        : value >= 3.55
          ? "fair"
          : value >= 3.3
            ? "low"
            : "critical";
    return {
      level,
      valueLabel: `${value.toFixed(1)}V`,
      description: `电池 ${value.toFixed(2)}V（暂按单节锂电池推测）`,
    };
  }
  const normalized = Math.min(100, Math.round(value));
  const level: VitalLevel =
    normalized >= 60
      ? "good"
      : normalized >= 30
        ? "fair"
        : normalized >= 15
          ? "low"
          : "critical";
  return {
    level,
    valueLabel: `${normalized}%`,
    description: `电量 ${normalized}%（暂按 60/30/15 分级）`,
  };
};

export const calibrationPayload = (
  type: string,
  parameters: string,
): JsonRecord => ({
  calibration_type: type.trim(),
  ...(parameters.trim() && parameters.trim() !== "{}"
    ? { parameters: JSON.parse(parameters) }
    : {}),
});

export const firmwarePayload = (
  version: string,
  packageUri: string,
  checksum: string,
  scheduledAt: string,
): JsonRecord => ({
  firmware_version: version.trim(),
  ...(packageUri.trim() ? { package_uri: packageUri.trim() } : {}),
  ...(checksum.trim() ? { checksum: checksum.trim() } : {}),
  ...(scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
});

export const sourceDeviceStatus = (
  source?: THCPNLatestAttributesResponse["source_device"],
) => {
  if (!source) return "—";
  const rawStatus = text(source.status, "未知");
  const status =
    {
      normal: "正常",
      online: "在线",
      offline: "离线",
      warning: "告警",
      error: "异常",
      disabled: "停用",
    }[rawStatus.toLowerCase()] ?? rawStatus;
  const active = source.active;
  return active === 0 ? `${status}（停用）` : status;
};

export const relativeTime = (input: string) => {
  const delta = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(delta)) return "时间未知";
  if (delta <= 0 || delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
};

export type DeviceTab =
  | "overview"
  | "data"
  | "video"
  | "profile"
  | "config"
  | "sharing"
  | "activity";

export const deviceDetailTab = (
  requested: string | null,
  camera: boolean,
  carbon = false,
): DeviceTab => {
  const allowed: DeviceTab[] = camera
    ? ["video", "profile", "activity"]
    : carbon
      ? ["overview", "data", "profile", "config", "sharing", "activity"]
      : ["overview", "data", "profile", "config", "sharing", "activity"];
  return requested && allowed.includes(requested as DeviceTab)
    ? (requested as DeviceTab)
    : camera
      ? "video"
      : "overview";
};

export const legacyDeviceTarget = (device: Device) =>
  `/devices/${encodeURIComponent(device.id)}?tab=${isCameraDevice(device) ? "video" : "data"}`;

export const filterQuickSwitchDevices = (devices: Device[], keyword: string) => {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return devices;
  return devices.filter((device) =>
    [device.name, device.serial_no, device.id]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalized)),
  );
};

export const formatDate = (input: unknown) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(input)))
    : "—";

export const isCameraDevice = (device?: Device) =>
  Boolean(
    device &&
    (device.device_type === "camera" ||
      device.topology_role === "camera" ||
      device.capabilities.some(
        (item) => item.includes("camera") || item.includes("live_view"),
      )),
  );
