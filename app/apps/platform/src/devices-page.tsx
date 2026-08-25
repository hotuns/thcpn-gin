import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  ArrowLeft,
  Battery,
  CircleAlert,
  CircleCheck,
  DatabaseZap,
  Eye,
  Gauge,
  MapPin,
  MoveRight,
  RadioTower,
  RefreshCw,
  ScanLine,
  Search,
  Signal,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  configFieldsFromDetail,
  deviceCapabilityLabel,
  deviceLifecycleLabel,
  deviceLifecycleOptions,
  deviceStatusLabel,
  deviceStatusOptions,
  deviceTopologyRoleLabel,
  formatApiError,
  parseTHCPNConfig,
  type Device,
  type JsonRecord,
  type THCPNLatestAttributesResponse,
  type THCPNConfigFields,
} from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";
import { CameraLive, isCameraDevice, RecentDeviceImages } from "./device-media";
import { DeviceDataPage } from "./pages";
import { TelemetryCharts } from "./telemetry-charts";
import { DeviceProfileTab } from "./device-profile";
import { DeviceSharingTab } from "./device-sharing";
import { CarbonDevicePage } from "./carbon-device-page";
import { SamplingProfilePanel } from "./sampling-profile";
import { DeviceCombobox } from "./device-combobox";
import { ComputedStreamsPanel, DeviceMetadataPanel } from "./device-computed-data";
import { GatewayNodeData } from "./gateway-node-data";

type DeviceCategory = "gateway" | "gateway_node" | "camera" | "carbon_sink" | "standalone";
type Category = "all" | Exclude<DeviceCategory, "gateway_node">;
type Mode = "calibration" | "firmware" | "transfer";
type VitalLevel = "good" | "fair" | "low" | "critical" | "unknown";
type VitalReading = {
  level: VitalLevel;
  valueLabel: string;
  description: string;
};
const text = (input: unknown, fallback: unknown = "—") =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const overviewTime = (input?: string) =>
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
const numericAttributeValue = (
  attribute?: THCPNLatestAttributesResponse["attributes"][string],
) => {
  const value = attribute?.parsed_value ?? attribute?.raw_value;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};
export const inferSignalReading = (value: number | null): VitalReading => {
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
export const inferBatteryReading = (value: number | null): VitalReading => {
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

export function DevicesPage() {
  const { currentId } = useWorkspace();
  const navigate = useNavigate();
  const [listParams] = useSearchParams();
  const [keyword, setKeyword] = useState("");
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [expandedId, setExpandedId] = useState("");
  const projects = useQuery({
    queryKey: workspaceQueryKey(currentId, "projects"),
    queryFn: () => api.projects.list(currentId!),
    enabled: Boolean(currentId),
  });
  const sites = useQuery({
    queryKey: workspaceQueryKey(currentId, "sites", projectId || "all"),
    queryFn: () => api.sites.list(currentId!, projectId || undefined),
    enabled: Boolean(currentId),
  });
  const query = useQuery({
    queryKey: workspaceQueryKey(
      currentId,
      "devices",
      projectId || "all",
      siteId || "all",
    ),
    queryFn: () =>
      api.devices.list(currentId!, {
        projectId: projectId || undefined,
        siteId: siteId || undefined,
      }),
    enabled: Boolean(currentId),
  });
  const all = query.data?.items ?? [];
  const topLevelDevices = useMemo(() => all.filter(isTopLevelDevice), [all]);
  const runtimeDeviceIDs = useMemo(
    () =>
      topLevelDevices
        .filter((device) => !["camera", "carbon_sink"].includes(deviceCategory(device)))
        .map((device) => device.id),
    [topLevelDevices],
  );
  const runtime = useQuery({
    queryKey: workspaceQueryKey(
      currentId,
      "device-runtime",
      runtimeDeviceIDs.join(","),
    ),
    queryFn: () => api.devices.runtime(runtimeDeviceIDs),
    enabled: Boolean(currentId && runtimeDeviceIDs.length),
    retry: false,
  });
  const runtimeByDevice = useMemo(
    () =>
      new Map(
        (runtime.data?.items ?? []).map((item) => [item.device_id, item]),
      ),
    [runtime.data?.items],
  );
  const counts = useMemo(
    () =>
      topLevelDevices.reduce<Record<Category, number>>(
        (result, item) => {
          result.all++;
          const itemCategory = deviceCategory(item);
          if (itemCategory !== "gateway_node") result[itemCategory]++;
          return result;
        },
        { all: 0, gateway: 0, camera: 0, carbon_sink: 0, standalone: 0 },
      ),
    [topLevelDevices],
  );
  const rows = useMemo(
    () =>
      topLevelDevices.filter(
        (item) =>
          (category === "all" || deviceCategory(item) === category) &&
          `${item.name} ${item.serial_no} ${item.id}`
            .toLowerCase()
            .includes(keyword.toLowerCase()),
      ),
    [topLevelDevices, category, keyword],
  );
  if (!currentId)
    return (
      <Panel>
        <StateView
          type="empty"
          title="请选择工作区"
          description="请先选择工作区，再查看设备列表。"
        />
      </Panel>
    );
  const siteName = (id?: string) =>
    text(
      sites.data?.items.find((item) => item.id === id)?.name,
      id ? id.slice(0, 8) : "未设置",
    );
  const projectName = (id?: string) =>
    text(
      projects.data?.items.find((item) => item.id === id)?.name,
      id ? id.slice(0, 8) : "未分配项目",
    );
  return (
    <>
      <Panel>
        {listParams.get("notice") && (
          <div className="command-note device-feedback">
            {listParams.get("notice")}
          </div>
        )}
        <div className="device-filter-bar">
          <div className="device-filter-main-row">
            <div className="filter-input">
              <Search size={15} />
              <input
                aria-label="搜索设备"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索名称、序列号或 ID"
              />
            </div>
            <div className="device-filter-actions">
              <Button variant="secondary" onClick={() => void query.refetch()}>
                <RefreshCw size={14} />
                刷新
              </Button>
              <Button onClick={() => navigate("/claim")}>
                <ScanLine size={14} />
                认领设备
              </Button>
            </div>
          </div>
          <div className="device-filter-scope-row">
            <span className="device-filter-label">位置范围</span>
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setSiteId("");
              }}
            >
              <option value="">全部项目</option>
              {projects.data?.items.map((item) => (
                <option key={text(item.id)} value={text(item.id)}>
                  {text(item.name)}
                </option>
              ))}
            </select>
            <select
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
            >
              <option value="">全部站点</option>
              {sites.data?.items.map((item) => (
                <option key={text(item.id)} value={text(item.id)}>
                  {text(item.name)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="device-categories">
          {(
            [
              { id: "all", label: "全部" },
              { id: "standalone", label: "标准站" },
              { id: "gateway", label: "组网站" },
              { id: "carbon_sink", label: "碳汇站" },
              { id: "camera", label: "监控站" },
            ] as Array<{ id: Category; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              className={category === item.id ? "active" : ""}
              onClick={() => setCategory(item.id)}
            >
              <span>{item.label}</span>
              <strong>{counts[item.id]}</strong>
            </button>
          ))}
        </div>
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载设备"
            description="正在读取当前工作区设备资产。"
          />
        ) : query.error ? (
          <StateView
            type="error"
            title="设备加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : rows.length ? (
          <div className="table-wrap">
            <table className="data-table device-table">
              <colgroup>
                <col className="device-table-name" />
                <col className="device-table-status" />
                <col className="device-table-data" />
                <col className="device-table-location" />
                <col className="device-table-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>设备</th>
                  <th>运行状态</th>
                  <th>数据与上报</th>
                  <th>位置归属</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((device) => (
                  <DeviceRows
                    key={device.id}
                    device={device}
                    workspaceId={currentId}
                    runtime={runtimeByDevice.get(device.id)}
                    runtimeLoading={runtime.isLoading}
                    expanded={expandedId === device.id}
                    projectName={projectName(device.project_id)}
                    siteName={siteName(device.site_id)}
                    onExpand={() =>
                      setExpandedId(expandedId === device.id ? "" : device.id)
                    }
                    onOpen={(id = device.id) =>
                      navigate(`/devices/${encodeURIComponent(id)}`)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StateView
            type="empty"
            title="没有匹配的设备"
            description={
              keyword || category !== "all" || projectId || siteId
                ? "请调整搜索或筛选条件。"
                : "当前工作区尚未分配系统设备。"
            }
          />
        )}
      </Panel>
    </>
  );
}

export function LegacyDeviceDataRedirect() {
  const { currentId } = useWorkspace();
  const [params] = useSearchParams();
  const deviceId = params.get("device") ?? "";
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices", "legacy-redirect"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  if (devices.isLoading)
    return <div className="app-loading">正在打开设备…</div>;
  const device = devices.data?.items.find((item) => item.id === deviceId);
  if (!device)
    return (
      <Navigate
        to="/devices?notice=设备不存在、已转移或当前账号无权访问"
        replace
      />
    );
  return <Navigate to={legacyDeviceTarget(device)} replace />;
}

function DeviceRows({
  device,
  workspaceId,
  runtime,
  runtimeLoading,
  expanded,
  projectName,
  siteName,
  onExpand,
  onOpen,
}: {
  device: Device;
  workspaceId: string;
  runtime?: THCPNLatestAttributesResponse;
  runtimeLoading: boolean;
  expanded: boolean;
  projectName: string;
  siteName: string;
  onExpand: () => void;
  onOpen: (id?: string) => void;
}) {
  const gateway = deviceCategory(device) === "gateway";
  const camera = deviceCategory(device) === "camera";
  return (
    <>
      <tr className={expanded ? "selected-row" : ""}>
        <td>
          <div className="device-name-cell">
            {gateway ? (
              <button
                aria-label={expanded ? "收起子节点" : "展开子节点"}
                onClick={onExpand}
              >
                {expanded ? (
                  <ChevronDown size={15} />
                ) : (
                  <ChevronRight size={15} />
                )}
              </button>
            ) : (
              <span className="device-indent" />
            )}
            <div>
              <button className="device-name-link" onClick={() => onOpen()}>
                {device.name}
              </button>
              <div className="device-identity-meta">
                <Badge>
                  {deviceTopologyRoleLabel(device.topology_role || device.device_type)}
                </Badge>
                <span>SN {device.serial_no}</span>
                {gateway && <span>{device.child_count} 个节点</span>}
              </div>
            </div>
          </div>
        </td>
        <td>
          <div className="device-operating-state">
            <Badge tone={deviceRuntimeTone(device, runtime)}>
              {deviceRuntimeLabel(device, runtime)}
            </Badge>
            <span>{deviceStatusLabel(device.status)}</span>
          </div>
          <div className="cell-sub">{deviceLifecycleLabel(device.lifecycle_status)}</div>
        </td>
        <td>
          {!camera && (
            <>
              <DeviceVitalIndicators
                attributes={runtime?.attributes}
                loading={runtimeLoading}
              />
              <div
                className="device-last-report"
                title={overviewTime(runtime?.source_device.updated_at)}
              >
                <Clock3 size={13} />
                <span>
                  {runtime?.source_device.updated_at
                    ? `最近上报 ${relativeTime(runtime.source_device.updated_at)}`
                    : "暂无上报时间"}
                </span>
              </div>
            </>
          )}
        </td>
        <td>
          <div className="device-placement-summary">
            <strong>{siteName}</strong>
            <span>{projectName}</span>
            <small title={runtime?.source_device ? formatSourceLocation(runtime.source_device) : undefined}>
              <MapPin size={12} />
              {runtime?.source_device ? compactSourceLocation(runtime.source_device) : "暂无定位"}
            </small>
          </div>
        </td>
        <td>
          <div className="device-actions">
            <Button onClick={() => onOpen()}>
              <Eye size={13} />
              {deviceCategory(device) === "camera" ? "查看视频" : "查看数据"}
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="children-row">
          <td colSpan={5}>
            <DeviceChildren
              workspaceId={workspaceId}
              deviceId={device.id}
              onData={onOpen}
            />
          </td>
        </tr>
      )}
    </>
  );
}

const sourceDeviceStatus = (
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

const deviceRuntimeTone = (
  device: Device,
  runtime?: THCPNLatestAttributesResponse,
): "success" | "warning" | "neutral" => {
  if (deviceCategory(device) === "camera")
    return device.lifecycle_status === "online" ? "success" : "neutral";
  if (!runtime) return "warning";
  return runtime.source_device.active === 0 ? "neutral" : "success";
};

const deviceRuntimeLabel = (
  device: Device,
  runtime?: THCPNLatestAttributesResponse,
) => {
  if (deviceCategory(device) === "camera")
    return deviceLifecycleLabel(device.lifecycle_status);
  if (!runtime) return "状态未知";
  return runtime.source_device.active === 0
    ? "已停用"
    : sourceDeviceStatus(runtime.source_device);
};

const relativeTime = (input: string) => {
  const delta = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(delta)) return "时间未知";
  if (delta <= 0 || delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
};

const formatSourceLocation = (
  source: THCPNLatestAttributesResponse["source_device"],
) => {
  if (source.lat === undefined || source.lon === undefined) return "暂无定位";
  const altitude = source.alt === undefined ? "" : ` · ${source.alt.toFixed(1)} m`;
  return `${source.lat.toFixed(6)}, ${source.lon.toFixed(6)}${altitude}`;
};

const compactSourceLocation = (
  source: THCPNLatestAttributesResponse["source_device"],
) => {
  if (source.lat === undefined || source.lon === undefined) return "暂无定位";
  return `${source.lat.toFixed(4)}, ${source.lon.toFixed(4)}`;
};

function DeviceVitalIndicators({
  attributes,
  loading = false,
}: {
  attributes?: THCPNLatestAttributesResponse["attributes"];
  loading?: boolean;
}) {
  const battery = inferBatteryReading(
    loading ? null : numericAttributeValue(attributes?.battery),
  );
  const signal = inferSignalReading(
    loading ? null : numericAttributeValue(attributes?.signal),
  );
  return (
    <div className={`device-vitals ${loading ? "loading" : ""}`}>
      <span
        className={`device-vital ${battery.level}`}
        title={loading ? "正在读取电量" : battery.description}
        aria-label={loading ? "正在读取电量" : battery.description}
      >
        <Battery size={15} aria-hidden="true" />
        <small>{loading ? "…" : battery.valueLabel}</small>
      </span>
      <span
        className={`device-vital ${signal.level}`}
        title={loading ? "正在读取信号" : signal.description}
        aria-label={loading ? "正在读取信号" : signal.description}
      >
        <Signal size={15} aria-hidden="true" />
        <small>{loading ? "…" : signal.valueLabel}</small>
      </span>
    </div>
  );
}

type DeviceTab =
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
      ? ["data", "profile", "config", "sharing", "activity"]
      : ["overview", "data", "profile", "config", "sharing", "activity"];
  return requested && allowed.includes(requested as DeviceTab)
    ? (requested as DeviceTab)
    : camera
      ? "video"
      : carbon
        ? "data"
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

function DeviceQuickSwitcher({
  device,
  devices,
  onSwitch,
}: {
  device: Device;
  devices: Device[];
  onSwitch: (deviceId: string) => void;
}) {
  return (
    <div className="device-quick-switch">
      <span>快捷切换设备</span>
      <DeviceCombobox devices={devices} value={device.id} onChange={onSwitch} ariaLabel="搜索并切换设备" />
    </div>
  );
}

export function DeviceCenterDetailPage() {
  const { deviceId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentId, workspaces } = useWorkspace();
  const { user } = useAuth();
  const detail = useQuery({
    queryKey: ["device", deviceId, "detail"],
    queryFn: () => api.devices.get(deviceId),
    enabled: Boolean(deviceId),
  });
  const detailWorkspaceId = detail.data?.workspace_id ?? currentId;
  const workspaceDevices = useQuery({
    queryKey: workspaceQueryKey(detailWorkspaceId, "devices", "quick-switch"),
    queryFn: () => api.devices.list(detailWorkspaceId!),
    enabled: Boolean(detailWorkspaceId),
  });
  const projects = useQuery({
    queryKey: workspaceQueryKey(detailWorkspaceId, "projects"),
    queryFn: () => api.projects.list(detailWorkspaceId!),
    enabled: Boolean(detailWorkspaceId),
  });
  const sites = useQuery({
    queryKey: workspaceQueryKey(detailWorkspaceId, "sites", "device-detail"),
    queryFn: () => api.sites.list(detailWorkspaceId!),
    enabled: Boolean(detailWorkspaceId),
  });
  const [feedback, setFeedback] = useState("");
  if (detail.isLoading)
    return (
      <Panel>
        <StateView
          type="loading"
          title="正在加载设备"
          description="正在读取设备详情。"
        />
      </Panel>
    );
  if (detail.error || !detail.data)
    return (
      <Panel>
        <StateView
          type="error"
          title="设备不可用"
          description={
            detail.error
              ? formatApiError(detail.error).message
              : "设备不存在、已转移或当前账号无权访问。"
          }
          requestId={
            detail.error ? formatApiError(detail.error).requestId : undefined
          }
          action={
            <Button onClick={() => navigate("/devices")}>返回设备列表</Button>
          }
        />
      </Panel>
    );
  const device = detail.data;
  if (!detailWorkspaceId)
    return (
      <Panel>
        <StateView
          type="error"
          title="设备缺少工作区信息"
          description="当前设备没有可用的工作区分配或共享授权。"
          action={<Button onClick={() => navigate("/devices")}>返回设备列表</Button>}
        />
      </Panel>
    );
  const carbonDevice = device.device_type === "carbon_sink";
  const camera = isCameraDevice(device);
  const tab = deviceDetailTab(params.get("tab"), camera, carbonDevice);
  if (params.get("tab") !== tab)
    return (
      <Navigate
        replace
        to={`/devices/${encodeURIComponent(device.id)}?tab=${encodeURIComponent(tab)}`}
      />
    );
  const workspaceDeviceItems = workspaceDevices.data?.items ?? [];
  const quickSwitchDevices = workspaceDeviceItems.some(
    (item) => item.id === device.id,
  )
    ? workspaceDeviceItems
    : [device, ...workspaceDeviceItems];
  const switchDevice = (nextDeviceId: string) => {
    const nextDevice = quickSwitchDevices.find((item) => item.id === nextDeviceId);
    let nextTab = tab;
    if (nextDevice) {
      const nextCamera = isCameraDevice(nextDevice);
      const nextCarbon = nextDevice.device_type === "carbon_sink";
      nextTab = deviceDetailTab(nextTab, nextCamera, nextCarbon);
      if (!nextCamera && tab === "video") nextTab = "data";
    }
    navigate(
      `/devices/${encodeURIComponent(nextDeviceId)}?tab=${encodeURIComponent(nextTab)}`,
    );
  };
  const run = async (
    action: () => Promise<unknown>,
    message: string,
    leavesWorkspace = false,
  ) => {
    setFeedback("");
    try {
      await action();
      if (leavesWorkspace) {
        navigate("/devices", { replace: true, state: { message } });
        return true;
      }
      setFeedback(message);
      await detail.refetch();
      return true;
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
      return false;
    }
  };
  const tabs = (
    camera
      ? [
          { id: "video", label: "实时视频" },
          { id: "profile", label: "资料" },
          { id: "activity", label: "记录" },
        ]
      : [
          ...(!carbonDevice ? [{ id: "overview" as DeviceTab, label: "概览" }] : []),
          { id: "data", label: deviceCategory(device) === "gateway" ? "节点数据" : "数据" },
          { id: "profile", label: "资料" },
          { id: "config", label: "配置" },
          { id: "sharing", label: "分享" },
          { id: "activity", label: "记录" },
        ]
  ) as Array<{ id: DeviceTab; label: string }>;
  return (
    <>
      <div className="device-detail-heading">
        <div>
          <h1>{device.name}</h1>
          <p>
            SN {device.serial_no} ·{" "}
            {deviceTopologyRoleLabel(
              device.topology_role || device.device_type,
            )}
          </p>
        </div>
        <div className="device-detail-actions">
          {quickSwitchDevices.length > 1 && (
            <DeviceQuickSwitcher
              device={device}
              devices={quickSwitchDevices}
              onSwitch={switchDevice}
            />
          )}
          <Link to="/devices">
            <Button variant="secondary">
              <ArrowLeft size={14} />
              设备列表
            </Button>
          </Link>
        </div>
      </div>
      <div className="device-detail-status">
        <Badge
          tone={device.lifecycle_status === "online" ? "success" : "warning"}
        >
          {deviceLifecycleLabel(device.lifecycle_status)}
        </Badge>
        <span>{deviceStatusLabel(device.status)}</span>
        <span className="mono">ID {device.id}</span>
      </div>
      <div className="settings-tabs device-detail-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setParams({ tab: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>
      {feedback && (
        <div className="command-note device-feedback">{feedback}</div>
      )}
      {carbonDevice && tab === "data" ? (
        <CarbonDevicePage device={device} />
      ) : tab === "overview" ? (
        <DeviceOverview
          device={device}
          workspaceId={detailWorkspaceId}
          onOpenData={() => setParams({ tab: "data" })}
        />
      ) : tab === "data" && deviceCategory(device) === "gateway" ? (
        <GatewayNodeData gateway={device} workspaceId={detailWorkspaceId} />
      ) : tab === "data" ? (
        <DeviceDataPage deviceId={device.id} embedded />
      ) : tab === "video" ? (
        <CameraLive device={device} />
      ) : tab === "profile" ? (
        <DeviceProfileTab
          workspaceId={detailWorkspaceId}
          device={device}
          projects={projects.data?.items ?? []}
          sites={sites.data?.items ?? []}
          operational={<DeviceProfileOperational workspaceId={detailWorkspaceId} device={device} />}
        />
      ) : tab === "sharing" ? (
        <DeviceSharingTab workspaceId={detailWorkspaceId} device={device} />
      ) : tab === "activity" ? (
        <DeviceActivity device={device} workspaceId={detailWorkspaceId} />
      ) : (
        <DeviceConfig
          device={device}
          currentWorkspaceId={detailWorkspaceId}
          workspaces={workspaces.map((item) => ({
            id: item.id,
            name: item.name,
          }))}
          systemAdmin={false}
          run={run}
        />
      )}
    </>
  );
}

function DeviceProfileOperational({ device, workspaceId }: { device: Device; workspaceId: string }) {
  const latestAttributes = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", device.id, "latest-attributes"),
    queryFn: () => api.devices.latestAttributes(device.id),
  });
  return <div className="device-profile-operational">
    <section className="device-profile-runtime-summary">
      <div className="device-profile-section-heading"><div><h3>运行概况</h3><span>能力与设备最新状态</span></div><span title={`最近更新 ${overviewTime(device.updated_at)}`}><Clock3 size={14} aria-hidden="true" />{overviewTime(device.updated_at)}</span></div>
      <div className="device-overview-summary">
        <div className="device-detail-capabilities device-overview-capabilities">{device.capabilities.length ? device.capabilities.map((item) => <span key={item} title={item}><Badge tone="info">{deviceCapabilityLabel(item)}</Badge></span>) : <span className="muted">未声明设备能力</span>}</div>
        <DeviceVitalIndicators attributes={latestAttributes.data?.attributes} loading={latestAttributes.isLoading} />
      </div>
    </section>
    <section className="device-source-runtime">
      <div className="device-profile-section-heading"><div><h3>源设备</h3><span>THCPN 实时状态</span></div></div>
      {latestAttributes.isLoading ? <StateView type="loading" title="正在读取源设备" description="" /> : latestAttributes.error ? <StateView type="error" title="源设备状态不可用" description={formatApiError(latestAttributes.error).message} /> : latestAttributes.data?.source_device ? <dl className="device-source-runtime-grid"><div><dt>运行状态</dt><dd>{sourceDeviceStatus(latestAttributes.data.source_device)}</dd></div><div><dt>当前版本</dt><dd>{text(latestAttributes.data.source_device.current_device_version ?? latestAttributes.data.source_device.version)}</dd></div><div><dt>源库更新时间</dt><dd>{overviewTime(latestAttributes.data.source_device.updated_at)}</dd></div></dl> : <StateView type="empty" title="暂无源设备状态" description="当前设备没有可读取的源库运行信息。" />}
    </section>
  </div>;
}

function DeviceOverview({
  device,
  workspaceId,
  onOpenData,
}: {
  device: Device;
  workspaceId: string;
  onOpenData: () => void;
}) {
  const children = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", device.id, "children"),
    queryFn: () => api.devices.children(device.id),
    enabled: deviceCategory(device) === "gateway",
  });
  const recentRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }, [device.id]);
  const camera = isCameraDevice(device);
  const hasTelemetry =
    !camera && device.capabilities.some((item) => item.includes("telemetry"));
  const hasImages =
    !camera && device.capabilities.some((item) => item.includes("image"));
  const telemetry = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "device",
      device.id,
      "overview",
      "telemetry",
      recentRange.startTime,
      recentRange.endTime,
    ),
    queryFn: () =>
      api.telemetry.device(device.id, {
        ...recentRange,
        limit: 240,
      }),
    enabled: hasTelemetry,
  });
  const recentSeries = (telemetry.data?.series ?? [])
    .filter((series) => series.points.length)
    .slice(0, 3);
  const gateway = deviceCategory(device) === "gateway";
  const childItems = children.data?.items ?? [];
  const childRuntimeQueries = useQueries({
    queries: gateway
      ? childItems.slice(0, 8).map(({ device: child }) => ({
          queryKey: workspaceQueryKey(workspaceId, "device", child.id, "latest-attributes", "gateway-overview"),
          queryFn: () => api.devices.latestAttributes(child.id),
          staleTime: 30_000,
        }))
      : [],
  });
  if (gateway) {
    return <GatewayOverview
      device={device}
      children={childItems}
      childRuntimeQueries={childRuntimeQueries}
      onOpenData={onOpenData}
    />;
  }
  return (
    <>
      {(hasTelemetry || hasImages) && (
        <div
          className={`device-overview-signals section-gap ${hasTelemetry && hasImages ? "split" : "single"}`}
        >
          {hasTelemetry && (
            <Panel className="overview-telemetry">
              <div className="panel-header compact-panel-header">
                <div>
                  <h2 className="panel-title">最近数据</h2>
                  <div className="panel-kicker">最近 24 小时 · 3 个指标</div>
                </div>
                <Button variant="secondary" onClick={onOpenData}>
                  查看全部
                </Button>
              </div>
              {telemetry.isLoading ? (
                <StateView
                  type="loading"
                  title="正在加载最近数据"
                  description="正在整理设备最近的遥测趋势。"
                />
              ) : telemetry.error ? (
                <StateView
                  type="error"
                  title="最近数据加载失败"
                  description={formatApiError(telemetry.error).message}
                  requestId={formatApiError(telemetry.error).requestId}
                />
              ) : recentSeries.length ? (
                <TelemetryCharts
                  compact
                  series={recentSeries}
                  startTime={recentRange.startTime}
                  endTime={recentRange.endTime}
                />
              ) : (
                <StateView
                  type="empty"
                  title="最近没有遥测数据"
                  description="最近 24 小时内没有可显示的数值指标。"
                />
              )}
            </Panel>
          )}
          {hasImages && (
            <RecentDeviceImages
              workspaceId={workspaceId}
              device={device}
              endTime={recentRange.endTime}
              startTime={new Date(
                Date.parse(recentRange.endTime) - 7 * 24 * 60 * 60 * 1000,
              ).toISOString()}
              onOpenData={onOpenData}
            />
          )}
        </div>
      )}
    </>
  );
}

function GatewayOverview({
  device,
  children,
  childRuntimeQueries,
  onOpenData,
}: {
  device: Device;
  children: Array<{ device: Device }>;
  childRuntimeQueries: Array<ReturnType<typeof useQuery<THCPNLatestAttributesResponse>>>;
  onOpenData: () => void;
}) {
  const onlineCount = children.filter(({ device: child }) => child.lifecycle_status === "online" || child.status === "active").length;
  const attentionCount = children.length - onlineCount;
  const reportingCount = childRuntimeQueries.filter((query) => query.data?.source_device?.updated_at).length;
  const healthPercent = children.length ? Math.round((onlineCount / children.length) * 100) : 0;
  const reportingPercent = children.length ? Math.round((reportingCount / Math.min(children.length, 8)) * 100) : 0;
  const visibleChildren = children.slice(0, 8);
  return <div className="gateway-overview">
    <section className="gateway-overview-hero">
      <div className="gateway-overview-hero-main"><div className="gateway-overview-icon"><RadioTower size={22}/></div><div><span>组网站数据概览</span><h2>{device.name}</h2><p>网关与下挂节点的连接、数据接入和最近活动</p></div></div>
      <div className="gateway-overview-hero-meta"><Badge tone={device.lifecycle_status === "online" ? "success" : "warning"}>{device.lifecycle_status === "online" ? "网关在线" : deviceLifecycleLabel(device.lifecycle_status)}</Badge><span className="mono">SN {device.serial_no}</span></div>
    </section>
    <div className="gateway-overview-kpis"><div><span>下挂节点</span><strong>{children.length}</strong><small>个节点</small></div><div><span>连接正常</span><strong>{onlineCount}</strong><small>/ {children.length || 0}</small></div><div><span>最近有数据</span><strong>{reportingCount}</strong><small>个节点</small></div><div className={attentionCount ? "is-warning" : "is-good"}><span>需要关注</span><strong>{attentionCount}</strong><small>{attentionCount ? "离线或无响应" : "全部正常"}</small></div></div>
    <div className="gateway-overview-grid section-gap">
      <Panel className="gateway-health-panel"><div className="panel-header"><div><h2 className="panel-title">节点健康度</h2><div className="panel-kicker">根据设备状态和最近源库响应判断</div></div><CircleCheck size={18}/></div><div className="gateway-health-content"><div className="gateway-health-score"><strong>{healthPercent}<small>%</small></strong><span>连接健康度</span><div className="gateway-health-bar"><i style={{width:`${healthPercent}%`}}/></div></div><div className="gateway-health-breakdown"><div><span><i className="is-online"/>在线</span><strong>{onlineCount}</strong></div><div><span><i className="is-attention"/>需关注</span><strong>{attentionCount}</strong></div><div><span><i className="is-reporting"/>有数据响应</span><strong>{reportingCount}</strong></div></div></div></Panel>
      <Panel className="gateway-pulse-panel"><div className="panel-header"><div><h2 className="panel-title">数据接入</h2><div className="panel-kicker">最近一次同步状态</div></div><DatabaseZap size={18}/></div><div className="gateway-pulse-stat"><div><strong>{reportingPercent}<small>%</small></strong><span>节点响应率</span></div><div className="gateway-pulse-bar"><i style={{width:`${reportingPercent}%`}}/></div><p>{reportingCount ? `已读取 ${reportingCount} 个节点的源设备状态` : "正在等待节点状态"}</p><Button variant="secondary" onClick={onOpenData}>查看组网站数据 <MoveRight size={14}/></Button></div></Panel>
    </div>
    <Panel className="gateway-nodes-panel"><div className="panel-header"><div><h2 className="panel-title">节点数据状态</h2><div className="panel-kicker">展示最近 8 个节点，可进入节点按时间查看完整数据</div></div><Badge tone="neutral">{children.length} 个节点</Badge></div>{children.length ? <div className="gateway-node-table"><div className="gateway-node-table-head"><span>节点</span><span>连接</span><span>信号 / 电量</span><span>最近响应</span><span></span></div>{visibleChildren.map(({device: child}, index) => { const runtime = childRuntimeQueries[index]; const attrs = runtime?.data?.attributes; const signal = inferSignalReading(firstNumericAttribute(attrs, ["rssi", "signal", "signal_strength"])); const battery = inferBatteryReading(firstNumericAttribute(attrs, ["battery", "bat", "voltage"])); const sourceUpdatedAt = runtime?.data?.source_device?.updated_at ?? child.updated_at; const isOnline = child.lifecycle_status === "online" || child.status === "active"; return <Link className="gateway-node-row" key={child.id} to={`/devices/${child.id}?tab=data`}><div className="gateway-node-name"><span className={`gateway-node-dot ${isOnline ? "is-online" : "is-offline"}`}/><div><strong>{child.name}</strong><small className="mono">SN {child.serial_no}</small></div></div><Badge tone={isOnline ? "success" : "warning"}>{isOnline ? "在线" : "离线"}</Badge><div className="gateway-node-vitals"><span>{signal.valueLabel}</span><span>{battery.valueLabel}</span></div><time>{overviewTime(sourceUpdatedAt)}</time><MoveRight size={15}/></Link>; })}</div> : <StateView type="empty" title="暂无下挂节点" description="当前组网站还没有可见的网关节点。"/>}{children.length > visibleChildren.length && <div className="gateway-node-table-foot"><span>还有 {children.length - visibleChildren.length} 个节点未展开</span><Button variant="secondary" onClick={onOpenData}>查看全部数据</Button></div>}</Panel>
    {attentionCount > 0 && <div className="gateway-overview-note"><CircleAlert size={16}/><span>{attentionCount} 个节点当前未在线，建议检查 LoRa 链路或设备供电。</span></div>}
  </div>;
}

function firstNumericAttribute(attributes: THCPNLatestAttributesResponse["attributes"] | undefined, keys: string[]) {
  for (const key of keys) {
    const value = numericAttributeValue(attributes?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function DeviceActivity({
  device,
  workspaceId,
}: {
  device: Device;
  workspaceId: string;
}) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "audit", "device", device.id),
    queryFn: () => api.audit.list(workspaceId, 500),
  });
  const members = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "members", "audit-names"),
    queryFn: () => api.members.list(workspaceId),
  });
  if (query.isLoading)
    return (
      <Panel>
        <StateView
          type="loading"
          title="正在加载操作记录"
          description="正在读取设备相关审计。"
        />
      </Panel>
    );
  if (query.error)
    return (
      <Panel>
        <StateView
          type="error"
          title="操作记录不可用"
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
        />
      </Panel>
    );
  const rows = (query.data?.items ?? []).filter(
    (item) => text(item.resource_id, "") === device.id,
  );
  const actorName = (item: JsonRecord) => {
    if (item.actor_type === "system") return "系统";
    if (text(item.actor_id, "") === user?.id) return user.name;
    const member = (members.data?.items ?? []).find(
      (entry) =>
        text(
          (entry.user as JsonRecord | undefined)?.id,
          text(entry.user_id, ""),
        ) === text(item.actor_id, ""),
    );
    const memberUser = member?.user as JsonRecord | undefined;
    return text(
      memberUser?.name,
      text(
        memberUser?.email,
        item.actor_type === "service_account" ? "服务账号" : "未知用户",
      ),
    );
  };
  return (
    <Panel>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">设备操作记录</h2>
          <div className="panel-kicker">
            最近 500 条工作区审计中的设备相关事件
          </div>
        </div>
        <Badge tone="neutral">{rows.length}</Badge>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作者</th>
                <th>动作</th>
                <th>资源</th>
                <th>结果</th>
                <th>Request ID</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={text(item.id)}>
                  <td>{formatDate(item.created_at)}</td>
                  <td>
                    <div className="cell-title">{actorName(item)}</div>
                    <div className="cell-sub mono">
                      {text(item.actor_id, "系统").slice(0, 8)}
                    </div>
                  </td>
                  <td>{text(item.action)}</td>
                  <td>
                    <div className="cell-title">{device.name}</div>
                    <div className="cell-sub mono">
                      {device.id.slice(0, 8)}…
                    </div>
                  </td>
                  <td>
                    <Badge
                      tone={item.result === "success" ? "success" : "danger"}
                    >
                      {text(item.result)}
                    </Badge>
                  </td>
                  <td className="mono">{text(item.request_id)}</td>
                  <td>{text(item.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StateView
          type="empty"
          title="暂无设备操作记录"
          description="当前审计窗口内没有该设备的操作事件。"
        />
      )}
    </Panel>
  );
}

const formatDate = (input: unknown) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(input)))
    : "—";

function DeviceConfig({
  device,
  currentWorkspaceId,
  workspaces,
  systemAdmin,
  run,
}: {
  device: Device;
  currentWorkspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
  systemAdmin: boolean;
  run: (
    action: () => Promise<unknown>,
    message: string,
    leavesWorkspace?: boolean,
  ) => Promise<boolean>;
}) {
  const streams = useQuery({ queryKey: workspaceQueryKey(currentWorkspaceId, "device", device.id, "streams", "config"), queryFn: () => api.dataStreams.list(device.id) });
  const profile = useQuery({ queryKey: workspaceQueryKey(currentWorkspaceId, "device", device.id, "profile", "config-access"), queryFn: () => api.devices.profile(device.id) });
  return (
    <div className="device-config-workspace">
      <div className="device-config-heading"><div><h2>数据配置</h2><p>管理设备业务参数、计算公式与采样方式</p></div><Badge tone="neutral">{streams.data?.items.length ?? 0} 个数据流</Badge></div>
      <div className="device-config-data-grid">
        <ComputedStreamsPanel workspaceId={currentWorkspaceId} deviceId={device.id} streams={streams.data?.items ?? []} />
        <DeviceMetadataPanel workspaceId={currentWorkspaceId} deviceId={device.id} canConfigure={Boolean(profile.data?.can_configure)} />
      </div>
      <SamplingProfilePanel deviceId={device.id} workspaceId={currentWorkspaceId} />
      {systemAdmin && (
        <SystemDeviceConfig device={device} workspaces={workspaces} run={run} />
      )}
      <Panel className="section-gap danger-zone">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">危险操作</h2>
            <div className="panel-kicker">
              解绑后设备资产保留，但不再属于当前工作区
            </div>
          </div>
          <Button
            variant="danger"
            onClick={() =>
              window.confirm(`确认解绑“${device.name}”？`) &&
              void run(() => api.devices.unbind(device.id), "设备已解绑", true)
            }
          >
            <Trash2 size={14} />
            解绑设备
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function SystemDeviceConfig({
  device,
  workspaces,
  run,
}: {
  device: Device;
  workspaces: Array<{ id: string; name: string }>;
  run: (
    action: () => Promise<unknown>,
    message: string,
    leavesWorkspace?: boolean,
  ) => Promise<boolean>;
}) {
  const lifecycle = useQuery({
    queryKey: ["admin", "device", device.id, "lifecycle"],
    queryFn: () => api.admin.lifecycle(device.id),
  });
  const config = useQuery({
    queryKey: ["admin", "device", device.id, "config"],
    queryFn: () => api.admin.deviceConfig(device.id),
  });
  const metadata = useQuery({
    queryKey: ["admin", "metadata", "capabilities"],
    queryFn: api.admin.metadata,
  });
  const [assetName, setAssetName] = useState(device.name);
  const [assetStatus, setAssetStatus] = useState(device.status);
  const [lifecycleStatus, setLifecycleStatus] = useState(
    device.lifecycle_status,
  );
  const [lifecycleNote, setLifecycleNote] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>(
    device.capabilities,
  );
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(
    device.workspace_id ?? "",
  );
  const [fields, setFields] = useState<THCPNConfigFields>({
    data_json: "[]",
    image_json: "[]",
    control_json: "{}",
    expected_config_id: 0,
  });
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    if (config.data) setFields(configFieldsFromDetail(config.data));
  }, [config.data]);
  const submitConfig = async () => {
    setLocalError("");
    try {
      const payload = parseTHCPNConfig(fields);
      if (!window.confirm("确认写入 THCPN 外部设备库并刷新平台数据流？"))
        return;
      await run(
        () => api.admin.updateDeviceConfig(device.id, payload),
        "THCPN 配置已应用",
      );
      await config.refetch();
    } catch (error) {
      setLocalError(formatApiError(error).message);
    }
  };
  const capabilityItems = metadata.data?.items ?? [];
  return (
    <Panel className="section-gap system-device-config">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">系统配置</h2>
          <div className="panel-kicker">
            仅系统管理员可见，所有修改调用平台级管理接口
          </div>
        </div>
        <Badge tone="info">SYSTEM ADMIN</Badge>
      </div>
      <div className="system-config-grid">
        <section>
          <h3>资产资料</h3>
          <label className="field">
            <span className="field-label">名称</span>
            <input
              value={assetName}
              onChange={(e) => setAssetName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">状态</span>
            <select
              value={assetStatus}
              onChange={(e) =>
                setAssetStatus(e.target.value as Device["status"])
              }
            >
              {deviceStatusOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {deviceStatusLabel(item.value)}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() =>
              void run(
                () =>
                  api.admin.updateDevice(device.id, {
                    name: assetName.trim(),
                    status: assetStatus,
                  }),
                "资产资料已更新",
              )
            }
          >
            保存资产资料
          </Button>
        </section>
        <section>
          <h3>生命周期</h3>
          <label className="field">
            <span className="field-label">新状态</span>
            <select
              value={lifecycleStatus}
              onChange={(e) =>
                setLifecycleStatus(e.target.value as Device["lifecycle_status"])
              }
            >
              {deviceLifecycleOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {deviceLifecycleLabel(item.value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">说明</span>
            <input
              value={lifecycleNote}
              onChange={(e) => setLifecycleNote(e.target.value)}
            />
          </label>
          <Button
            disabled={lifecycle.isLoading}
            onClick={() =>
              void run(
                () =>
                  api.admin.updateLifecycle(device.id, {
                    lifecycle_status: lifecycleStatus,
                    note: lifecycleNote.trim(),
                  }),
                "生命周期已更新",
              )
            }
          >
            更新生命周期
          </Button>
        </section>
        <section>
          <h3>最终能力</h3>
          <div className="system-capabilities">
            {capabilityItems.map((item) => {
              const code = text(item.code, "");
              return (
                <label key={code}>
                  <input
                    type="checkbox"
                    checked={capabilities.includes(code)}
                    disabled={item.status !== "active"}
                    onChange={() =>
                      setCapabilities((current) =>
                        current.includes(code)
                          ? current.filter((value) => value !== code)
                          : [...current, code],
                      )
                    }
                  />
                  <span>
                    {text(item.name, code)}
                    <small>{code}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <Button
            disabled={metadata.isLoading}
            onClick={() =>
              void run(
                () => api.admin.updateCapabilities(device.id, { capabilities }),
                "设备能力已更新",
              )
            }
          >
            保存能力
          </Button>
        </section>
        <section>
          <h3>工作区分配</h3>
          <label className="field">
            <span className="field-label">目标工作区</span>
            <select
              value={targetWorkspaceId}
              onChange={(e) => setTargetWorkspaceId(e.target.value)}
            >
              <option value="">未分配</option>
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            disabled={!targetWorkspaceId}
            onClick={() =>
              void run(
                () =>
                  api.admin.assignDevice(device.id, {
                    target_workspace_id: targetWorkspaceId,
                    assign_children: false,
                  }),
                "设备分配已更新",
                targetWorkspaceId !== device.workspace_id,
              )
            }
          >
            更新分配
          </Button>
        </section>
      </div>
      <section className="thcpn-config-editor">
        <h3>THCPN 高级配置</h3>
        <div className="form-error config-warning">
          保存会创建新的外部配置版本，并重新生成设备数据通道。
        </div>
        <label className="field">
          <span className="field-label">数据通道 · data_json</span>
          <textarea
            value={fields.data_json}
            onChange={(e) =>
              setFields((current) => ({
                ...current,
                data_json: e.target.value,
              }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">图片通道 · image_json</span>
          <textarea
            value={fields.image_json}
            onChange={(e) =>
              setFields((current) => ({
                ...current,
                image_json: e.target.value,
              }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">控制配置 · control_json</span>
          <textarea
            value={fields.control_json}
            onChange={(e) =>
              setFields((current) => ({
                ...current,
                control_json: e.target.value,
              }))
            }
          />
        </label>
        {localError && <div className="form-error">{localError}</div>}
        <Button
          variant="danger"
          disabled={config.isLoading}
          onClick={() => void submitConfig()}
        >
          应用 THCPN 配置
        </Button>
      </section>
      {isCameraDevice(device) && (
        <SystemCameraBinding device={device} run={run} />
      )}
    </Panel>
  );
}

function SystemCameraBinding({
  device,
  run,
}: {
  device: Device;
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const query = useQuery({
    queryKey: ["admin", "camera", device.id],
    queryFn: () => api.admin.camera(device.id),
  });
  const [deviceSerial, setDeviceSerial] = useState("");
  const [channelNo, setChannelNo] = useState(1);
  const [quality, setQuality] = useState("hd");
  const [status, setStatus] = useState("active");
  const [encrypted, setEncrypted] = useState(false);
  const [secretRef, setSecretRef] = useState("");
  useEffect(() => {
    const binding = query.data?.binding as JsonRecord | undefined;
    if (!binding) return;
    setDeviceSerial(text(binding.device_serial, ""));
    setChannelNo(Number(binding.channel_no) || 1);
    setQuality(text(binding.default_quality, "hd"));
    setStatus(text(binding.status, "active"));
    setEncrypted(Boolean(binding.is_encrypted));
    setSecretRef(text(binding.validate_code_secret_ref, ""));
  }, [query.data]);
  return (
    <section className="thcpn-config-editor camera-binding-editor">
      <h3>监控站视频绑定</h3>
      {query.isLoading ? (
        <StateView
          type="loading"
          title="正在加载监控站视频绑定"
          description="正在读取视频通道配置。"
        />
      ) : query.error ? (
        <StateView
          type="error"
          title="监控站视频绑定加载失败"
          description={formatApiError(query.error).message}
        />
      ) : (
        <>
          <div className="device-form-grid">
            <label className="field">
              <span className="field-label">设备序列号</span>
              <input
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">通道号</span>
              <input
                type="number"
                min="1"
                value={channelNo}
                onChange={(e) => setChannelNo(Number(e.target.value) || 1)}
              />
            </label>
            <label className="field">
              <span className="field-label">默认清晰度</span>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                {["fluent", "standard", "hd", "ultra_hd"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">状态</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">设备加密</span>
              <select
                value={String(encrypted)}
                onChange={(e) => setEncrypted(e.target.value === "true")}
              >
                <option value="false">未加密</option>
                <option value="true">已加密</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">验证码 Secret 引用</span>
              <input
                value={secretRef}
                onChange={(e) => setSecretRef(e.target.value)}
              />
            </label>
          </div>
          <Button
            disabled={!deviceSerial.trim()}
            onClick={() =>
              void run(
                () =>
                  api.admin.updateCamera(device.id, {
                    device_serial: deviceSerial.trim(),
                    channel_no: channelNo,
                    default_quality: quality,
                    status,
                    is_encrypted: encrypted,
                    validate_code_secret_ref: secretRef.trim(),
                  }),
                "监控站视频绑定已更新",
              )
            }
          >
            保存监控站视频绑定
          </Button>
        </>
      )}
    </section>
  );
}

function DeviceDetail({
  deviceId,
  onClose,
  onData,
}: {
  deviceId: string;
  onClose: () => void;
  onData: () => void;
}) {
  const [streamId, setStreamId] = useState("");
  const detail = useQuery({
    queryKey: ["device", deviceId, "detail"],
    queryFn: () => api.devices.get(deviceId),
  });
  const streams = useQuery({
    queryKey: ["device", deviceId, "streams", "detail"],
    queryFn: () => api.dataStreams.list(deviceId),
  });
  const stream = useQuery({
    queryKey: ["data-stream", streamId, "detail"],
    queryFn: () => api.dataStreams.get(streamId),
    enabled: Boolean(streamId),
  });
  if (detail.isLoading)
    return (
      <Panel className="section-gap">
        <StateView
          type="loading"
          title="正在加载设备详情"
          description="正在读取设备与数据流。"
        />
      </Panel>
    );
  if (detail.error)
    return (
      <Panel className="section-gap">
        <StateView
          type="error"
          title="设备详情加载失败"
          description={formatApiError(detail.error).message}
          requestId={formatApiError(detail.error).requestId}
        />
      </Panel>
    );
  const device = detail.data;
  return (
    <Panel className="section-gap device-detail">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">设备详情 · {device?.name}</h2>
          <div className="panel-kicker mono">
            SN {device?.serial_no} · ID {device?.id}
          </div>
        </div>
        <div className="header-actions">
          <Button onClick={onData}>
            <Eye size={13} />
            查看数据
          </Button>
          <Button variant="secondary" onClick={onClose}>
            <X size={13} />
            关闭
          </Button>
        </div>
      </div>
      <div className="device-detail-summary">
        <div>
          <span>设备类型</span>
          <strong>{device?.device_type}</strong>
        </div>
        <div>
          <span>拓扑角色</span>
          <strong>{device?.topology_role}</strong>
        </div>
        <div>
          <span>生命周期</span>
          <strong>{deviceLifecycleLabel(device?.lifecycle_status)}</strong>
        </div>
        <div>
          <span>资产状态</span>
          <strong>{deviceStatusLabel(device?.status)}</strong>
        </div>
        <div>
          <span>创建时间</span>
          <strong>{text(device?.created_at)}</strong>
        </div>
        <div>
          <span>更新时间</span>
          <strong>{text(device?.updated_at)}</strong>
        </div>
      </div>
      <div className="device-detail-capabilities">
        {device?.capabilities.map((item) => (
          <span key={item} title={item}>
            <Badge tone="info">{deviceCapabilityLabel(item)}</Badge>
          </span>
        ))}
      </div>
      <div className="panel-header">
        <div>
          <h3 className="panel-title">数据流</h3>
          <div className="panel-kicker">只读通道，不展示数据库绑定信息</div>
        </div>
        <Badge tone="neutral">{streams.data?.items.length ?? 0}</Badge>
      </div>
      {streams.isLoading ? (
        <StateView
          type="loading"
          title="正在加载数据流"
          description="正在读取设备通道。"
        />
      ) : streams.error ? (
        <StateView
          type="error"
          title="数据流加载失败"
          description={formatApiError(streams.error).message}
          requestId={formatApiError(streams.error).requestId}
        />
      ) : streams.data?.items.length ? (
        <div className="device-stream-list">
          {streams.data.items.map((item) => (
            <button
              key={item.id}
              className={streamId === item.id ? "selected" : ""}
              onClick={() => setStreamId(item.id)}
            >
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.code} · {item.id}
                </small>
              </span>
              <span>
                <Badge tone={item.status === "active" ? "success" : "neutral"}>
                  {item.status}
                </Badge>
                <small>
                  {item.type} · {item.unit || "无单位"}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <StateView
          type="empty"
          title="没有数据流"
          description="系统尚未为该设备同步可见通道。"
        />
      )}
      {streamId && (
        <div className="stream-detail-line">
          {stream.isLoading ? (
            "正在读取数据流详情…"
          ) : stream.error ? (
            `详情加载失败：${formatApiError(stream.error).message}`
          ) : (
            <>
              <strong>{stream.data?.name}</strong>
              <span className="mono">
                {stream.data?.code} · {stream.data?.id}
              </span>
              <span>
                {stream.data?.type} / {stream.data?.unit || "无单位"}
              </span>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function DeviceChildren({
  workspaceId,
  deviceId,
  onData,
}: {
  workspaceId: string;
  deviceId: string;
  onData: (id?: string) => void;
}) {
  const query = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", deviceId, "children"),
    queryFn: () => api.devices.children(deviceId),
  });
  if (query.isLoading)
    return (
      <StateView
        type="loading"
        title="正在加载子节点"
        description="正在读取网关拓扑。"
      />
    );
  if (query.error)
    return (
      <StateView
        type="error"
        title="子节点加载失败"
        description={formatApiError(query.error).message}
        requestId={formatApiError(query.error).requestId}
      />
    );
  if (!query.data?.items.length)
    return (
      <StateView
        type="empty"
        title="没有可见子节点"
        description="当前网关没有同工作区且可访问的子设备。"
      />
    );
  return (
    <div className="child-device-list">
      {query.data.items.map(({ device }) => (
        <div key={device.id}>
          <div>
            <div className="cell-title">{device.name}</div>
            <div className="cell-sub mono">
              SN {device.serial_no} · ID {device.id}
            </div>
          </div>
          <div>
            <Badge tone={device.status === "active" ? "success" : "neutral"}>
              {deviceStatusLabel(device.status)}
            </Badge>
            <Button variant="secondary" onClick={() => onData(device.id)}>
              查看数据
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeviceActionForm({
  device,
  mode,
  currentWorkspaceId,
  workspaces,
  onClose,
  onComplete,
}: {
  device: Device;
  mode: Mode;
  currentWorkspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
  onClose: () => void;
  onComplete: (
    action: () => Promise<unknown>,
    message: string,
  ) => Promise<boolean>;
}) {
  const [calibrationType, setCalibrationType] = useState("zero_point");
  const [parameters, setParameters] = useState("{}");
  const [version, setVersion] = useState("");
  const [packageUri, setPackageUri] = useState("");
  const [checksum, setChecksum] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const [targetProjectId, setTargetProjectId] = useState("");
  const [targetSiteId, setTargetSiteId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targetProjects = useQuery({
    queryKey: ["workspace", targetWorkspaceId, "projects", "transfer"],
    queryFn: () => api.projects.list(targetWorkspaceId),
    enabled: mode === "transfer" && Boolean(targetWorkspaceId),
  });
  const targetSites = useQuery({
    queryKey: [
      "workspace",
      targetWorkspaceId,
      "sites",
      targetProjectId,
      "transfer",
    ],
    queryFn: () =>
      api.sites.list(targetWorkspaceId, targetProjectId || undefined),
    enabled: mode === "transfer" && Boolean(targetWorkspaceId),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "calibration")
        await onComplete(
          () =>
            api.devices.calibrate(
              device.id,
              calibrationPayload(calibrationType, parameters),
            ),
          "校准请求已创建",
        );
      if (mode === "firmware")
        await onComplete(
          () =>
            api.devices.firmwareUpgrade(
              device.id,
              firmwarePayload(version, packageUri, checksum, scheduledAt),
            ),
          "固件升级任务已创建",
        );
      if (mode === "transfer")
        await onComplete(
          () =>
            api.devices.transfer(device.id, {
              target_workspace_id: targetWorkspaceId,
              ...(targetProjectId ? { project_id: targetProjectId } : {}),
              ...(targetSiteId ? { site_id: targetSiteId } : {}),
              transfer_historical_datasets: false,
              confirm_dataset_policy: true,
            }),
          "设备已转移",
        );
    } catch (reason) {
      const item = formatApiError(reason);
      setError(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="section-gap device-editor">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            {mode === "calibration"
              ? "请求设备校准"
              : mode === "firmware"
                ? "安排固件升级"
                : "转移设备"}
          </h2>
          <div className="panel-kicker">
            {device.name} · SN {device.serial_no}
          </div>
        </div>
        <Button variant="secondary" onClick={onClose}>
          <X size={14} />
          关闭
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="device-form-grid">
          {mode === "calibration" ? (
            <>
              <label className="field">
                <span className="field-label">校准流程</span>
                <select
                  value={calibrationType}
                  onChange={(event) => setCalibrationType(event.target.value)}
                >
                  <option value="zero_point">零点校准</option>
                  <option value="span">量程校准</option>
                  <option value="factory_reset">恢复出厂校准</option>
                  <option value="custom">自定义流程</option>
                </select>
              </label>
              <label className="field field-wide">
                <span className="field-label">设备参数 JSON（可选）</span>
                <textarea
                  value={parameters}
                  onChange={(event) => setParameters(event.target.value)}
                  spellCheck={false}
                />
              </label>
            </>
          ) : mode === "firmware" ? (
            <>
              <label className="field">
                <span className="field-label">目标版本</span>
                <input
                  required
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="例如 2.4.1"
                />
              </label>
              <label className="field">
                <span className="field-label">固件包 URI</span>
                <input
                  value={packageUri}
                  onChange={(event) => setPackageUri(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Checksum</span>
                <input
                  value={checksum}
                  onChange={(event) => setChecksum(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">计划执行时间</span>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span className="field-label">目标工作区</span>
                <select
                  required
                  value={targetWorkspaceId}
                  onChange={(event) => {
                    setTargetWorkspaceId(event.target.value);
                    setTargetProjectId("");
                    setTargetSiteId("");
                  }}
                >
                  <option value="">选择工作区</option>
                  {workspaces
                    .filter((item) => item.id !== currentWorkspaceId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">目标项目</span>
                <select
                  value={targetProjectId}
                  disabled={!targetWorkspaceId}
                  onChange={(event) => {
                    setTargetProjectId(event.target.value);
                    setTargetSiteId("");
                  }}
                >
                  <option value="">不设置</option>
                  {targetProjects.data?.items.map((item) => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">目标站点</span>
                <select
                  value={targetSiteId}
                  disabled={!targetProjectId}
                  onChange={(event) => setTargetSiteId(event.target.value)}
                >
                  <option value="">不设置</option>
                  {targetSites.data?.items.map((item) => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="transfer-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  我确认历史数据集保留在原工作区，当前版本不会迁移历史数据集。
                </span>
              </label>
            </>
          )}
        </div>
        {error && <div className="form-error device-form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant={mode === "transfer" ? "danger" : "primary"}
            disabled={
              busy ||
              (mode === "firmware" && !version.trim()) ||
              (mode === "transfer" && (!targetWorkspaceId || !confirmed))
            }
          >
            {busy ? "提交中…" : mode === "transfer" ? "确认转移" : "提交"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
