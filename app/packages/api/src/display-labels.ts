const label = (
  labels: Record<string, { zh: string; en: string }>,
  value?: string,
  fallback?: string,
) => (value ? (labels[value]?.[typeof document !== "undefined" && document.documentElement.lang === "en-US" ? "en" : "zh"] ?? fallback ?? value) : (fallback ?? "—"));

export const deviceStatusOptions = [
  { value: "active", label: "启用" },
  { value: "disabled", label: "停用" },
  { value: "retired", label: "已退役" },
] as const;

export const deviceLifecycleOptions = [
  { value: "inbound", label: "待入库" },
  { value: "installed", label: "已安装" },
  { value: "online", label: "在线运行" },
  { value: "maintenance", label: "维护中" },
  { value: "repairing", label: "维修中" },
  { value: "retired", label: "已退役" },
] as const;

const topologyRoleLabels = {
  standalone: { zh: "标准站", en: "Station" },
  gateway: { zh: "网关", en: "Gateway" },
  gateway_node: { zh: "网关节点", en: "Gateway node" },
  camera: { zh: "监控站", en: "Monitoring station" },
};

const deviceCapabilityLabels = {
  telemetry: { zh: "遥测数据", en: "Telemetry" },
  image_capture: { zh: "图片采集", en: "Image capture" },
  video_stream: { zh: "实时视频", en: "Live video" },
  ptz_control: { zh: "云台控制", en: "PTZ control" },
  remote_command: { zh: "远程控制", en: "Remote control" },
  configurable: { zh: "参数配置", en: "Configuration" },
  calibratable: { zh: "设备校准", en: "Calibration" },
  firmware_update: { zh: "固件升级", en: "Firmware update" },
  edge_storage: { zh: "边缘存储", en: "Edge storage" },
};

const roleTemplateLabels = {
  owner: { zh: "所有者", en: "Owner" },
  admin: { zh: "管理员", en: "Administrator" },
  project_manager: { zh: "项目管理员", en: "Project manager" },
  site_operator: { zh: "站点运维人员", en: "Site operator" },
  data_manager: { zh: "数据管理员", en: "Data manager" },
  researcher: { zh: "研究人员", en: "Researcher" },
  viewer: { zh: "查看者", en: "Viewer" },
  shared_viewer: { zh: "共享查看者", en: "Shared viewer" },
  shared_downloader: { zh: "共享下载者", en: "Shared downloader" },
  service_engineer: { zh: "服务工程师", en: "Service engineer" },
  custom: { zh: "自定义权限", en: "Custom permissions" },
};

const roleTemplateDefaultNames: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  project_manager: "Project Manager",
  site_operator: "Site Operator",
  data_manager: "Data Manager",
  researcher: "Researcher",
  viewer: "Viewer",
  shared_viewer: "Shared Viewer",
  shared_downloader: "Shared Downloader",
  service_engineer: "Service Engineer",
  custom: "Custom",
};

const commonStatusLabels = {
  active: { zh: "有效", en: "Active" }, disabled: { zh: "停用", en: "Disabled" }, retired: { zh: "已退役", en: "Retired" }, pending: { zh: "待处理", en: "Pending" }, accepted: { zh: "已接受", en: "Accepted" }, revoked: { zh: "已撤销", en: "Revoked" }, expired: { zh: "已过期", en: "Expired" }, archived: { zh: "已归档", en: "Archived" }, success: { zh: "成功", en: "Success" }, failed: { zh: "失败", en: "Failed" },
};

export const deviceStatusLabel = (value?: string) =>
  label({ active: { zh: "启用", en: "Enabled" }, disabled: { zh: "停用", en: "Disabled" }, retired: { zh: "已退役", en: "Retired" } }, value);

export const deviceLifecycleLabel = (value?: string) =>
  label({ inbound: { zh: "待入库", en: "Pending intake" }, installed: { zh: "已安装", en: "Installed" }, online: { zh: "在线运行", en: "Online" }, maintenance: { zh: "维护中", en: "Maintenance" }, repairing: { zh: "维修中", en: "Repairing" }, retired: { zh: "已退役", en: "Retired" } }, value);

export const deviceTopologyRoleLabel = (value?: string) =>
  label(topologyRoleLabels, value);

export const deviceCapabilityLabel = (value?: string) =>
  label(deviceCapabilityLabels, value, typeof document !== "undefined" && document.documentElement.lang === "en-US" ? "Extended capability" : "扩展能力");

export const roleTemplateLabel = (code?: string, fallbackName?: string) => {
  const name = fallbackName?.trim();
  const defaultName = code ? roleTemplateDefaultNames[code] : undefined;
  if (name && (!defaultName || name.toLowerCase() !== defaultName.toLowerCase())) {
    return name;
  }
  return label(roleTemplateLabels, code, name);
};

export const commonStatusLabel = (value?: string) =>
  label(commonStatusLabels, value);
