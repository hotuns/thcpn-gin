import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  Check,
  Clock3,
  ArrowLeft,
  Battery,
  BellRing,
  CircleAlert,
  CircleCheck,
  DatabaseZap,
  Eye,
  FileText,
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
  type DeviceTaxonomyTerm,
  type JsonRecord,
  type TelemetrySeries,
  type THCPNLatestAttributesResponse,
  type THCPNConfigFields,
} from "@thcpn/api";
import { iconifyIconUrl } from "@thcpn/device-map";
import { useAuth } from "@thcpn/auth";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Panel, StateView, Table } from "./platform-ui";
import { CameraLive, isCameraDevice, RecentDeviceImages } from "./device-media";
import { DeviceDataPage } from "./pages";
import { TelemetryCharts } from "./telemetry-charts";
import { DeviceProfileTab } from "./device-profile";
import { DeviceSharingTab } from "./device-sharing";
import { GatewayOverview } from "./gateway-overview";
import { CarbonDeviceOverview } from "./carbon-device-page";
import { CarbonDevicePage } from "./carbon-device-page";
import { SamplingProfilePanel } from "./sampling-profile";
import { DeviceCombobox } from "./device-combobox";
import { ComputedStreamsPanel, DeviceMetadataPanel } from "./device-computed-data";
import { GatewayNodeData } from "./gateway-node-data";
import {
  DEVICE_LIST_GC_TIME,
  DEVICE_LIST_STALE_TIME,
  deviceListQueryKey,
} from "./device-list-cache";

type DeviceCategory = "gateway" | "gateway_node" | "camera" | "carbon_sink" | "standalone";
type Category = "all" | Exclude<DeviceCategory, "gateway_node">;
type Mode = "calibration" | "firmware" | "transfer";
type VitalLevel = "good" | "fair" | "low" | "critical" | "unknown";
type VitalReading = {
  level: VitalLevel;
  valueLabel: string;
  description: string;
};
type FilterOption = { value: string; label: string };
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
export const matchesDeviceType = (
  selectedTypeId: string,
  deviceType?: Pick<DeviceTaxonomyTerm, "id">,
) => !selectedTypeId || deviceType?.id === selectedTypeId;
const deviceModelLabel = (device: Pick<Device, "device_type" | "source_family">) =>
  device.device_type === "gateway"
    ? device.source_family === "lorawan_v2"
      ? "LoRa V2 网关"
      : "THCPN 组网站网关"
    : deviceTopologyRoleLabel(device.device_type);
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

function DeviceFilterSelect({ label, value, options, onChange }: { label: string; value: string; options: FilterOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.value === value) ?? options[0];
  const select = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return <div className={`device-filter-select ${open ? "is-open" : ""}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{selected?.label}</span><ChevronDown size={15}/>
    </button>
    {open ? <div className="device-filter-select-menu" role="listbox">
      {options.map((item) => <button type="button" role="option" aria-selected={item.value === value} key={item.value || "all"} onClick={() => select(item.value)}><span>{item.label}</span>{item.value === value ? <Check size={14}/> : null}</button>)}
    </div> : null}
  </div>;
}

export function DevicesPage() {
  const { currentId } = useWorkspace();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listParams] = useSearchParams();
  const [keyword, setKeyword] = useState("");
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [deviceTypeId, setDeviceTypeId] = useState("");
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
    queryKey: deviceListQueryKey(currentId, projectId, siteId),
    queryFn: () =>
      api.devices.list(currentId!, {
        projectId: projectId || undefined,
        siteId: siteId || undefined,
      }),
    enabled: Boolean(currentId),
    staleTime: DEVICE_LIST_STALE_TIME,
    gcTime: DEVICE_LIST_GC_TIME,
  });
  const mapQuery = useQuery({
    queryKey: workspaceQueryKey(currentId, "device-map", "false"),
    queryFn: () => api.devices.map(currentId!, false),
    enabled: Boolean(currentId),
  });
  const taxonomy = useQuery({
    queryKey: ["device-taxonomy"],
    queryFn: api.devices.taxonomy,
    staleTime: DEVICE_LIST_STALE_TIME,
    gcTime: DEVICE_LIST_GC_TIME,
  });
  const deviceTypeByDevice = useMemo(
    () =>
      new Map(
        (mapQuery.data?.items ?? []).map((item) => [
          item.device_id,
          item.environment.ecosystem,
        ]),
      ),
    [mapQuery.data?.items],
  );
  const tagsByDevice = useMemo(
    () => new Map((mapQuery.data?.items ?? []).map((item) => [item.device_id, item.environment.research_tags])),
    [mapQuery.data?.items],
  );
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
          matchesDeviceType(deviceTypeId, deviceTypeByDevice.get(item.id)) &&
          `${item.name} ${item.serial_no} ${item.id} ${(tagsByDevice.get(item.id) ?? []).join(" ")}`
            .toLowerCase()
            .includes(keyword.toLowerCase()),
      ),
    [topLevelDevices, category, deviceTypeByDevice, deviceTypeId, keyword, tagsByDevice],
  );
  if (!currentId)
    return (
      <Panel data-onboarding="device-list">
        <StateView
          type="empty"
          title="请选择组织"
          description="请先选择组织，再查看设备列表。"
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
        <div className="device-filter-bar" data-onboarding="device-filters">
          <div className="device-filter-main-row">
            <div className="filter-input">
              <Search size={15} />
              <input
                aria-label="搜索设备"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索名称、序列号、ID 或标签"
              />
            </div>
            <div className="device-filter-actions">
              <Button variant="secondary" onClick={() => void query.refetch()}>
                <RefreshCw size={14} />
                刷新
              </Button>
              {!user?.is_demo && <Button data-onboarding="claim-entry" onClick={() => navigate("/claim")}>
                <ScanLine size={14} />
                添加设备
              </Button>}
            </div>
          </div>
          <div className="device-filter-scope-row">
            <DeviceFilterSelect
              label="筛选项目"
              value={projectId}
              options={[{ value: "", label: "全部项目" }, ...(projects.data?.items ?? []).map((item) => ({ value: text(item.id), label: text(item.name) }))]}
              onChange={(value) => {
                setProjectId(value);
                setSiteId("");
              }}
            />
            <DeviceFilterSelect
              label="筛选站点"
              value={siteId}
              options={[{ value: "", label: "全部站点" }, ...(sites.data?.items ?? []).map((item) => ({ value: text(item.id), label: text(item.name) }))]}
              onChange={setSiteId}
            />
            <DeviceFilterSelect
              label="筛选设备类型"
              value={deviceTypeId}
              options={[
                { value: "", label: "全部设备类型" },
                ...(taxonomy.data?.items ?? [])
                  .filter((item) => item.kind === "ecosystem")
                  .map((item) => ({ value: item.id, label: item.name_zh })),
              ]}
              onChange={setDeviceTypeId}
            />
            {(projectId || siteId || deviceTypeId) && <button type="button" className="device-filter-reset" onClick={() => { setProjectId(""); setSiteId(""); setDeviceTypeId(""); }}><X size={13} />重置筛选</button>}
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
            description="正在读取当前组织设备资产。"
          />
        ) : query.error && !query.data ? (
          <StateView
            type="error"
            title="设备加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : rows.length ? (
          <div className="table-wrap">
            <Table className="data-table device-table">
              <colgroup>
                <col className="device-table-name" />
                <col className="device-table-vitals" />
                <col className="device-table-report" />
                <col className="device-table-assignment" />
                <col className="device-table-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>设备</th>
                  <th>电量 / 信号</th>
                  <th>最近上报</th>
                  <th>项目 / 站点</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((device) => (
                  <DeviceRows
                    key={device.id}
                    device={device}
                    deviceType={deviceTypeByDevice.get(device.id)}
                    workspaceId={currentId}
                    runtime={runtimeByDevice.get(device.id)}
                    runtimeLoading={runtime.isLoading}
                    tags={tagsByDevice.get(device.id) ?? []}
                    expanded={expandedId === device.id}
                    projectName={device.source_project_name || projectName(device.project_id)}
                    siteName={device.source_site_name || device.source_workspace_name || siteName(device.site_id)}
                    onExpand={() =>
                      setExpandedId(expandedId === device.id ? "" : device.id)
                    }
                    onOpen={(id = device.id, tab) =>
                      navigate(`/devices/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ""}`)
                    }
                  />
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <StateView
            type="empty"
            title="没有匹配的设备"
            description={
              keyword || category !== "all" || projectId || siteId || deviceTypeId
                ? "请调整搜索或筛选条件。"
                : "当前组织尚未分配系统设备。"
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
    queryKey: deviceListQueryKey(currentId),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
    staleTime: DEVICE_LIST_STALE_TIME,
    gcTime: DEVICE_LIST_GC_TIME,
  });
  if (devices.isLoading)
    return <div className="app-loading t-shimmer" data-text="正在打开设备…">正在打开设备…</div>;
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
  deviceType,
  workspaceId,
  runtime,
  runtimeLoading,
  tags,
  expanded,
  projectName,
  siteName,
  onExpand,
  onOpen,
}: {
  device: Device;
  deviceType?: DeviceTaxonomyTerm;
  workspaceId: string;
  runtime?: THCPNLatestAttributesResponse;
  runtimeLoading: boolean;
  tags: string[];
  expanded: boolean;
  projectName: string;
  siteName: string;
  onExpand: () => void;
  onOpen: (id?: string, tab?: string) => void;
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
                  {deviceModelLabel(device)}
                </Badge>
                {deviceType ? (
                  <span className="device-type-classification">
                    {iconifyIconUrl(deviceType.icon) ? (
                      <img src={iconifyIconUrl(deviceType.icon)} alt="" />
                    ) : null}
                    {deviceType.name_zh}
                  </span>
                ) : null}
                <span>SN {device.serial_no}</span>
                {gateway && <span>{`${device.child_count} 个节点`}</span>}
              </div>
              {tags.length ? <div className="device-row-tags">{tags.slice(0,2).map((tag)=><span key={tag}>{tag}</span>)}{tags.length>2?<span>+{tags.length-2}</span>:null}</div> : null}
            </div>
          </div>
        </td>
        <td>
          {!camera?<DeviceVitalIndicators attributes={runtime?.attributes} loading={runtimeLoading}/>:<span className="cell-sub">不适用</span>}
        </td>
        <td>
          {!camera?<div className="device-last-report" title={overviewTime(runtime?.source_device.updated_at)}><Clock3 size={13}/><span>{runtime?.source_device.updated_at?relativeTime(runtime.source_device.updated_at):"暂无上报"}</span></div>:<span className="cell-sub">视频设备</span>}
        </td>
        <td>
          <div className="device-placement-summary">
            <strong>{siteName}</strong>
            <span>{projectName}</span>
          </div>
        </td>
        <td>
          <div className="device-actions">
            <Button aria-label={camera ? "查看视频" : "查看数据"} title={camera ? "查看视频" : "查看数据"} data-onboarding={camera ? undefined : "device-data-entry"} data-onboarding-route={camera ? undefined : `/devices/${encodeURIComponent(device.id)}?tab=data`} onClick={() => onOpen(undefined,camera?"video":"data")}>
              <Eye size={13} />
            </Button>
            <Button aria-label="查看设备资料" title="查看设备资料" variant="secondary" onClick={() => onOpen(undefined,"profile")}><FileText size={13}/></Button>
            {!camera?<Button aria-label="查看设备配置" title="查看设备配置" variant="secondary" onClick={() => onOpen(undefined,"config")}><Settings2 size={13}/></Button>:null}
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

const relativeTime = (input: string) => {
  const delta = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(delta)) return "时间未知";
  if (delta <= 0 || delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
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
    queryKey: deviceListQueryKey(detailWorkspaceId),
    queryFn: () => api.devices.list(detailWorkspaceId!),
    enabled: Boolean(detailWorkspaceId),
    staleTime: DEVICE_LIST_STALE_TIME,
    gcTime: DEVICE_LIST_GC_TIME,
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
          title="设备缺少组织信息"
          description="当前设备没有可用的组织分配或共享授权。"
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
        to={`/devices/${encodeURIComponent(device.id)}?${new URLSearchParams({ ...Object.fromEntries(params), tab })}`}
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
          { id: "overview" as DeviceTab, label: "概览" },
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
        <div className="device-detail-title">
          <h1>{device.name}</h1>
          <div className="device-detail-meta">
            <span>
              SN {device.serial_no} · {deviceModelLabel(device)}
            </span>
            <Badge
              tone={device.lifecycle_status === "online" ? "success" : "warning"}
            >
              {deviceLifecycleLabel(device.lifecycle_status)}
            </Badge>
            <span>{deviceStatusLabel(device.status)}</span>
          </div>
        </div>
        <div className="device-detail-actions">
          {quickSwitchDevices.length > 1 && (
            <DeviceQuickSwitcher
              device={device}
              devices={quickSwitchDevices}
              onSwitch={switchDevice}
            />
          )}
          <Link to={`/alerts?new=1&device=${device.id}`}>
            <Button variant="secondary"><BellRing size={14}/>创建预警</Button>
          </Link>
          <Link to="/devices">
            <Button variant="secondary">
              <ArrowLeft size={14} />
              设备列表
            </Button>
          </Link>
        </div>
      </div>
      <DeviceDetailTabs tabs={tabs} activeTab={tab} onChange={(nextTab) => setParams((current) => { const next = new URLSearchParams(current); next.set("tab", nextTab); return next; })} />
      {feedback && (
        <div className="command-note device-feedback">{feedback}</div>
      )}
      <div className="device-detail-tab-content" key={tab}>
      {carbonDevice && tab === "data" ? (
        <CarbonDevicePage device={device} />
      ) : tab === "overview" ? (
        <DeviceOverview
          device={device}
          workspaceId={detailWorkspaceId}
          onOpenData={() => setParams((current) => { const next = new URLSearchParams(current); next.set("tab", "data"); return next; })}
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
      </div>
    </>
  );
}

function DeviceDetailTabs({ tabs, activeTab, onChange }: { tabs: Array<{ id: DeviceTab; label: string }>; activeTab: DeviceTab; onChange: (tab: DeviceTab) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const movePill = (animate: boolean) => {
    const bar = barRef.current;
    const pill = pillRef.current;
    const active = bar?.querySelector<HTMLButtonElement>("button.active");
    if (!bar || !pill || !active) return;
    if (!animate) pill.style.transition = "none";
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    pill.style.width = `${active.offsetWidth}px`;
    if (!animate) {
      void pill.offsetWidth;
      pill.style.transition = "";
    }
  };
  useEffect(() => {
    requestAnimationFrame(() => movePill(false));
    const onResize = () => movePill(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeTab, tabs.length]);
  return <div ref={barRef} className="settings-tabs device-detail-tabs t-tabs" data-onboarding="device-tabs">
    <span ref={pillRef} className="t-tabs-pill" aria-hidden="true" />
    {tabs.map((item) => <button type="button" role="tab" aria-selected={activeTab === item.id} key={item.id} className={activeTab === item.id ? "active t-tab" : "t-tab"} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>;
}

function DeviceProfileOperational({ device, workspaceId }: { device: Device; workspaceId: string }) {
  const carbonDevice = deviceCategory(device) === "carbon_sink";
  const latestAttributes = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", device.id, "latest-attributes"),
    queryFn: () => api.devices.latestAttributes(device.id),
    enabled: device.source_family === "thcpn",
  });
  const carbonOverview = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", device.id, "carbon-overview"),
    queryFn: () => api.carbon.overview(device.id),
    enabled: carbonDevice,
  });
  if (device.source_family === "lorawan_v2") return <Panel><div className="panel-header"><h3>设备接入</h3><Badge tone={device.source_status === "active" ? "success" : "warning"}>{device.source_status === "active" ? "已启用" : "已停用"}</Badge></div><p>LoRaWAN V2 组网站 · {device.child_count} 个节点</p></Panel>;
  return <div className="device-profile-operational">
    <section className="device-profile-runtime-summary">
      <div className="device-profile-section-heading"><div><h3><Gauge size={16} />运行概况</h3><span>能力与设备最新状态</span></div><span title={`最近更新 ${overviewTime(device.updated_at)}`}><Clock3 size={14} aria-hidden="true" />{overviewTime(device.updated_at)}</span></div>
      <div className="device-overview-summary">
        <div className="device-detail-capabilities device-overview-capabilities">{device.capabilities.length ? device.capabilities.map((item) => <span key={item} title={item}><Badge tone="info">{deviceCapabilityLabel(item)}</Badge></span>) : <span className="muted">未声明设备能力</span>}</div>
        <DeviceVitalIndicators attributes={latestAttributes.data?.attributes} loading={!carbonDevice && latestAttributes.isLoading} />
      </div>
    </section>
    <section className="device-source-runtime">
      <div className="device-profile-section-heading"><div><h3><DatabaseZap size={16} />源设备</h3><span>{carbonDevice ? "碳汇源库状态" : "THCPN 实时状态"}</span></div></div>
      {carbonDevice ? carbonOverview.isLoading ? <StateView type="loading" title="正在读取碳汇源库" description="" /> : carbonOverview.error ? <StateView type="error" title="碳汇源库状态不可用" description={formatApiError(carbonOverview.error).message} /> : carbonOverview.data ? <dl className="device-source-runtime-grid"><div><dt>电池</dt><dd>{carbonOverview.data.runtime?.battery ? `${carbonOverview.data.runtime.battery}%` : "—"}</dd></div><div><dt>信号</dt><dd>{text(carbonOverview.data.runtime?.signal)}</dd></div><div><dt>网络</dt><dd>{text(carbonOverview.data.runtime?.network)}</dd></div><div><dt>源库更新时间</dt><dd>{overviewTime(carbonOverview.data.refreshed_at)}</dd></div></dl> : <StateView type="empty" title="暂无碳汇源库状态" description="当前设备没有可读取的源库运行信息。" /> : latestAttributes.isLoading ? <StateView type="loading" title="正在读取源设备" description="" /> : latestAttributes.error ? <StateView type="error" title="源设备状态不可用" description={formatApiError(latestAttributes.error).message} /> : latestAttributes.data?.source_device ? <dl className="device-source-runtime-grid"><div><dt>运行状态</dt><dd>{sourceDeviceStatus(latestAttributes.data.source_device)}</dd></div><div><dt>当前版本</dt><dd>{text(latestAttributes.data.source_device.current_device_version ?? latestAttributes.data.source_device.version)}</dd></div><div><dt>源库更新时间</dt><dd>{overviewTime(latestAttributes.data.source_device.updated_at)}</dd></div></dl> : <StateView type="empty" title="暂无源设备状态" description="当前设备没有可读取的源库运行信息。" />}
    </section>
  </div>;
}

function DeviceOverview(props: { device: Device; workspaceId: string; onOpenData: () => void }) {
  if (props.device.device_type === "gateway") return <GatewayOverview device={props.device} workspaceId={props.workspaceId}/>;
  if (props.device.device_type === "carbon_sink") return <CarbonDeviceOverview device={props.device}/>;
  return <StandardDeviceOverview {...props}/>;
}

function StandardDeviceOverview({
  device,
  workspaceId,
  onOpenData,
}: {
  device: Device;
  workspaceId: string;
  onOpenData: () => void;
}) {
  const recentRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 2 * 24 * 60 * 60 * 1000);
    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }, [device.id]);
  const camera = isCameraDevice(device);
  const hasTelemetry =
    !camera && device.features?.includes("telemetry");
  const hasImages =
    !camera && device.features?.includes("media");
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
      api.telemetry.device(device.id, recentRange),
    enabled: hasTelemetry,
  });
  const recentSeries = (telemetry.data?.series ?? [])
    .filter((series) => series.points.length);
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
                  <div className="panel-kicker">最近两天 · 全部指标</div>
                </div>
                <Button variant="secondary" onClick={onOpenData}>
                  查看全部
                </Button>
              </div>
              {telemetry.isLoading ? (
                <StateView
                  type="loading"
                  title="正在加载最近数据"
                  description="正在整理设备最近的数据趋势。"
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
                  displayMode="separate"
                  series={recentSeries}
                  startTime={recentRange.startTime}
                  endTime={recentRange.endTime}
                />
              ) : (
                <StateView
                  type="empty"
                  title="最近没有设备数据"
                  description="最近两天内没有可显示的数值指标。"
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
                Date.parse(recentRange.endTime) - 7 * 7 * 24 * 60 * 60 * 1000,
              ).toISOString()}
              onOpenData={onOpenData}
            />
          )}
        </div>
      )}
    </>
  );
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
            最近 500 条组织审计中的设备相关事件
          </div>
        </div>
        <Badge tone="neutral">{rows.length}</Badge>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <Table className="data-table">
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
          </Table>
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
  const context = useQuery({ queryKey: workspaceQueryKey(currentWorkspaceId, "device", device.id, "context"), queryFn: () => api.devices.context(device.id) });
  return (
    <div className="device-config-workspace">
      <div className="device-config-heading"><div><h2>数据配置</h2><p>管理设备业务参数、计算公式与采样方式</p></div><Badge tone="neutral">{streams.data?.items.length ?? 0} 个数据流</Badge></div>
      <div className="device-config-data-grid">
        <ComputedStreamsPanel workspaceId={currentWorkspaceId} deviceId={device.id} streams={streams.data?.items ?? []} />
        <DeviceMetadataPanel workspaceId={currentWorkspaceId} deviceId={device.id} canConfigure={Boolean(context.data?.actions.configure)} />
      </div>
      {device.features?.includes("sampling") && <SamplingProfilePanel deviceId={device.id} workspaceId={currentWorkspaceId} carbon={device.device_type === "carbon_sink"} />}
      {systemAdmin && (
        <SystemDeviceConfig device={device} workspaces={workspaces} run={run} />
      )}
      <Panel className="section-gap danger-zone">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">危险操作</h2>
            <div className="panel-kicker">
              解绑后设备资产保留，但不再属于当前组织
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
          <h3>组织分配</h3>
          <label className="field">
            <span className="field-label">目标组织</span>
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

export function DeviceChildren({
  workspaceId,
  deviceId,
  onData,
}: {
  workspaceId: string;
  deviceId: string;
  onData: (id?: string) => void;
}) {
  const query = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", deviceId, "nodes"),
    queryFn: () => api.devices.nodes(deviceId),
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
        description="当前网关尚未配置节点，或没有可访问的节点。"
      />
    );
  return (
    <div className="child-device-list">
      {query.data.items.map((node) => (
        <div key={node.key}>
          <div>
            <div className="cell-title">{node.name}</div>
            <div className="cell-sub">
              {node.streams.length ? `${node.streams.length} 个指标` : "暂无指标"}
            </div>
          </div>
          <div>
            {node.target.kind === "device" ? (
              <Button variant="secondary" onClick={() => onData(node.target.kind === "device" ? node.target.device_id : undefined)}>
                查看数据
              </Button>
            ) : (
              <Link className="button button-secondary" to={`/devices/${encodeURIComponent(deviceId)}?tab=data&node=${encodeURIComponent(node.key)}`}>
                查看数据
              </Link>
            )}
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
                <span className="field-label">目标组织</span>
                <select
                  required
                  value={targetWorkspaceId}
                  onChange={(event) => {
                    setTargetWorkspaceId(event.target.value);
                    setTargetProjectId("");
                    setTargetSiteId("");
                  }}
                >
                  <option value="">选择组织</option>
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
                  我确认历史数据集保留在原组织，当前版本不会迁移历史数据集。
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
