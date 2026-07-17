const label = (
  labels: Record<string, string>,
  value?: string,
  fallback?: string,
) => (value ? (labels[value] ?? fallback ?? value) : (fallback ?? "—"));

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

const topologyRoleLabels: Record<string, string> = {
  standalone: "独立设备",
  gateway: "网关",
  gateway_node: "网关节点",
  camera: "相机",
};

const deviceCapabilityLabels: Record<string, string> = {
  telemetry: "遥测数据",
  image_capture: "图片采集",
  video_stream: "实时视频",
  ptz_control: "云台控制",
  remote_command: "远程控制",
  configurable: "参数配置",
  calibratable: "设备校准",
  firmware_update: "固件升级",
  edge_storage: "边缘存储",
};

const roleTemplateLabels: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  project_manager: "项目管理员",
  site_operator: "站点运维人员",
  data_manager: "数据管理员",
  researcher: "研究人员",
  viewer: "查看者",
  shared_viewer: "共享查看者",
  shared_downloader: "共享下载者",
  service_engineer: "服务工程师",
  custom: "自定义权限",
};

const commonStatusLabels: Record<string, string> = {
  active: "有效",
  disabled: "停用",
  retired: "已退役",
  pending: "待处理",
  accepted: "已接受",
  revoked: "已撤销",
  expired: "已过期",
  archived: "已归档",
  success: "成功",
  failed: "失败",
};

export const deviceStatusLabel = (value?: string) =>
  label(
    Object.fromEntries(
      deviceStatusOptions.map((item) => [item.value, item.label]),
    ),
    value,
  );

export const deviceLifecycleLabel = (value?: string) =>
  label(
    Object.fromEntries(
      deviceLifecycleOptions.map((item) => [item.value, item.label]),
    ),
    value,
  );

export const deviceTopologyRoleLabel = (value?: string) =>
  label(topologyRoleLabels, value);

export const deviceCapabilityLabel = (value?: string) =>
  label(deviceCapabilityLabels, value, "扩展能力");

export const roleTemplateLabel = (code?: string, fallbackName?: string) =>
  label(roleTemplateLabels, code, fallbackName);

export const commonStatusLabel = (value?: string) =>
  label(commonStatusLabels, value);
