import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
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
  ArrowLeft,
  Eye,
  Gauge,
  Info,
  MoveRight,
  RefreshCw,
  Search,
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

type DeviceCategory = "gateway" | "gateway_node" | "camera" | "standalone";
type Category = "all" | Exclude<DeviceCategory, "gateway_node">;
type Mode = "placement" | "calibration" | "firmware" | "transfer";
const text = (input: unknown, fallback: unknown = "—") =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const overviewTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat("zh-CN", {
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
  const role = device.topology_role || device.device_type;
  return role === "gateway" || role === "gateway_node" || role === "camera"
    ? role
    : "standalone";
};
export const isTopLevelDevice = (
  device: Pick<Device, "topology_role" | "device_type">,
) => deviceCategory(device) !== "gateway_node";
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
  const counts = useMemo(
    () =>
      topLevelDevices.reduce<Record<Category, number>>(
        (result, item) => {
          result.all++;
          const itemCategory = deviceCategory(item);
          if (itemCategory !== "gateway_node") result[itemCategory]++;
          return result;
        },
        { all: 0, gateway: 0, camera: 0, standalone: 0 },
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
          title="请选择 Workspace"
          description="设备列表依赖 Workspace 上下文。"
        />
      </Panel>
    );
  const siteName = (id?: string) =>
    text(
      sites.data?.items.find((item) => item.id === id)?.name,
      id ? id.slice(0, 8) : "未设置",
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
          <div className="filter-input">
            <Search size={15} />
            <input
              aria-label="搜索设备"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索名称、序列号或 ID"
            />
          </div>
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setSiteId("");
            }}
          >
            <option value="">全部 Project</option>
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
            <option value="">全部 Site</option>
            {sites.data?.items.map((item) => (
              <option key={text(item.id)} value={text(item.id)}>
                {text(item.name)}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            <RefreshCw size={14} />
            刷新
          </Button>
        </div>
        <div className="device-categories">
          {(
            [
              { id: "all", label: "全部" },
              { id: "gateway", label: "组网站" },
              { id: "camera", label: "相机" },
              { id: "standalone", label: "普通设备" },
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
            description="正在读取当前 Workspace 设备资产。"
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
                <col className="device-table-topology" />
                <col className="device-table-lifecycle" />
                <col className="device-table-site" />
                <col className="device-table-capabilities" />
                <col className="device-table-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>设备</th>
                  <th>拓扑</th>
                  <th>生命周期</th>
                  <th>Site</th>
                  <th>能力</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((device) => (
                  <DeviceRows
                    key={device.id}
                    device={device}
                    workspaceId={currentId}
                    expanded={expandedId === device.id}
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
                : "当前 Workspace 尚未分配系统设备。"
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
  expanded,
  siteName,
  onExpand,
  onOpen,
}: {
  device: Device;
  workspaceId: string;
  expanded: boolean;
  siteName: string;
  onExpand: () => void;
  onOpen: (id?: string) => void;
}) {
  const gateway = deviceCategory(device) === "gateway";
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
              <div className="cell-sub">{device.serial_no}</div>
              <div className="cell-sub mono">{device.id}</div>
            </div>
          </div>
        </td>
        <td>
          {deviceTopologyRoleLabel(device.topology_role || device.device_type)}
          <div className="cell-sub">
            {gateway ? `${device.child_count} 个子节点` : "独立资产"}
          </div>
        </td>
        <td>
          <Badge
            tone={
              device.lifecycle_status === "online"
                ? "success"
                : device.lifecycle_status === "retired"
                  ? "neutral"
                  : "warning"
            }
          >
            {deviceLifecycleLabel(device.lifecycle_status)}
          </Badge>
          <div className="cell-sub">{deviceStatusLabel(device.status)}</div>
        </td>
        <td>{siteName}</td>
        <td>
          <div className="capability-list">
            {device.capabilities.slice(0, 3).map((item) => (
              <span key={item} title={item}>
                <Badge>{deviceCapabilityLabel(item)}</Badge>
              </span>
            ))}
            {device.capabilities.length > 3 && (
              <span className="muted">+{device.capabilities.length - 3}</span>
            )}
          </div>
        </td>
        <td>
          <div className="device-actions">
            <Button onClick={() => onOpen()}>
              <Info size={13} />
              查看
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="children-row">
          <td colSpan={6}>
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
): DeviceTab => {
  const allowed: DeviceTab[] = [
    "overview",
    camera ? "video" : "data",
    "profile",
    "config",
    "sharing",
    "activity",
  ];
  return requested && allowed.includes(requested as DeviceTab)
    ? (requested as DeviceTab)
    : "overview";
};
export const legacyDeviceTarget = (device: Device) =>
  `/devices/${encodeURIComponent(device.id)}?tab=${isCameraDevice(device) ? "video" : "data"}`;

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
  const [editing, setEditing] = useState<Mode | null>(null);
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
          title="设备缺少访问上下文"
          description="当前设备没有可用的 Workspace 分配或共享授权。"
          action={<Button onClick={() => navigate("/devices")}>返回设备列表</Button>}
        />
      </Panel>
    );
  const camera = isCameraDevice(device);
  const tab = deviceDetailTab(params.get("tab"), camera);
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
  const tabs = [
    { id: "overview", label: "概览" },
    { id: camera ? "video" : "data", label: camera ? "实时视频" : "数据" },
    { id: "profile", label: "资料" },
    { id: "config", label: "配置" },
    { id: "sharing", label: "分享" },
    { id: "activity", label: "操作记录" },
  ] as Array<{ id: DeviceTab; label: string }>;
  return (
    <>
      <div className="device-detail-heading">
        <div>
          <h1>{device.name}</h1>
          <p>
            {device.serial_no} ·{" "}
            {deviceTopologyRoleLabel(
              device.topology_role || device.device_type,
            )}
          </p>
        </div>
        <Link to="/devices">
          <Button variant="secondary">
            <ArrowLeft size={14} />
            设备列表
          </Button>
        </Link>
      </div>
      <div className="device-detail-status">
        <Badge
          tone={device.lifecycle_status === "online" ? "success" : "warning"}
        >
          {deviceLifecycleLabel(device.lifecycle_status)}
        </Badge>
        <span>{deviceStatusLabel(device.status)}</span>
        <span className="mono">{device.id}</span>
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
      {tab === "overview" ? (
        <DeviceOverview
          device={device}
          workspaceId={detailWorkspaceId}
          projects={projects.data?.items ?? []}
          sites={sites.data?.items ?? []}
          onOpenData={() => setParams({ tab: "data" })}
        />
      ) : tab === "data" ? (
        <DeviceDataPage deviceId={device.id} embedded />
      ) : tab === "video" ? (
        <CameraLive device={device} />
      ) : tab === "profile" ? (
        <DeviceProfileTab workspaceId={detailWorkspaceId} device={device} />
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
          projects={projects.data?.items ?? []}
          sites={sites.data?.items ?? []}
          systemAdmin={false}
          editing={editing}
          setEditing={setEditing}
          run={run}
        />
      )}
    </>
  );
}

function DeviceOverview({
  device,
  workspaceId,
  projects,
  sites,
  onOpenData,
}: {
  device: Device;
  workspaceId: string;
  projects: JsonRecord[];
  sites: JsonRecord[];
  onOpenData: () => void;
}) {
  const project = projects.find((item) => text(item.id) === device.project_id);
  const site = sites.find((item) => text(item.id) === device.site_id);
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
  const fields = [
    ["设备类型", deviceTopologyRoleLabel(device.device_type)],
    ["拓扑角色", deviceTopologyRoleLabel(device.topology_role)],
    ["Project", project?.name ?? "未设置"],
    ["Site", site?.name ?? "未设置"],
    ["创建时间", overviewTime(device.created_at)],
    ["更新时间", overviewTime(device.updated_at)],
  ];
  return (
    <>
      <Panel>
        <div className="device-overview-grid">
          {fields.map(([label, value]) => (
            <div key={String(label)}>
              <span>{String(label)}</span>
              <strong>{text(value)}</strong>
            </div>
          ))}
        </div>
        <div className="device-detail-capabilities">
          {device.capabilities.length ? (
            device.capabilities.map((item) => (
              <span key={item} title={item}>
                <Badge tone="info">{deviceCapabilityLabel(item)}</Badge>
              </span>
            ))
          ) : (
            <span className="muted">未声明设备能力</span>
          )}
        </div>
      </Panel>
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
      {deviceCategory(device) === "gateway" && (
        <Panel className="section-gap">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">网关拓扑</h2>
              <div className="panel-kicker">当前 Workspace 可见子节点</div>
            </div>
            <Badge tone="neutral">{device.child_count}</Badge>
          </div>
          {children.isLoading ? (
            <StateView
              type="loading"
              title="正在加载子节点"
              description="正在读取设备拓扑。"
            />
          ) : children.error ? (
            <StateView
              type="error"
              title="拓扑加载失败"
              description={formatApiError(children.error).message}
            />
          ) : children.data?.items.length ? (
            <div className="series-list">
              {children.data.items.map(({ device: child }) => (
                <Link
                  className="series-row"
                  key={child.id}
                  to={`/devices/${child.id}`}
                >
                  <div>
                    <div className="cell-title">{child.name}</div>
                    <div className="cell-sub mono">{child.serial_no}</div>
                  </div>
                  <Badge
                    tone={child.status === "active" ? "success" : "neutral"}
                  >
                    {deviceStatusLabel(child.status)}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <StateView
              type="empty"
              title="暂无子节点"
              description="当前网关没有可见子设备。"
            />
          )}
        </Panel>
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
            最近 500 条 Workspace 审计中的设备相关事件
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
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(input)))
    : "—";

function DeviceConfig({
  device,
  currentWorkspaceId,
  workspaces,
  projects,
  sites,
  systemAdmin,
  editing,
  setEditing,
  run,
}: {
  device: Device;
  currentWorkspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
  projects: JsonRecord[];
  sites: JsonRecord[];
  systemAdmin: boolean;
  editing: Mode | null;
  setEditing: (mode: Mode | null) => void;
  run: (
    action: () => Promise<unknown>,
    message: string,
    leavesWorkspace?: boolean,
  ) => Promise<boolean>;
}) {
  const actions: Array<{ mode: Mode; label: string; show: boolean }> = [
    { mode: "placement", label: "Project / Site", show: true },
    {
      mode: "calibration",
      label: "设备校准",
      show: device.capabilities.some((item) => item.includes("calibrat")),
    },
    {
      mode: "firmware",
      label: "固件升级",
      show: device.capabilities.some((item) => item.includes("firmware")),
    },
    { mode: "transfer", label: "转移设备", show: true },
  ];
  return (
    <>
      <Panel>
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Workspace 配置</h2>
            <div className="panel-kicker">
              按当前账号权限调整设备在 Workspace 中的使用方式
            </div>
          </div>
        </div>
        <div className="device-config-actions">
          {actions
            .filter((item) => item.show)
            .map((item) => (
              <Button
                key={item.mode}
                variant="secondary"
                onClick={() => setEditing(item.mode)}
              >
                <Settings2 size={14} />
                {item.label}
              </Button>
            ))}
        </div>
      </Panel>
      {editing && (
        <DeviceActionForm
          key={`${device.id}-${editing}`}
          device={device}
          mode={editing}
          currentWorkspaceId={currentWorkspaceId}
          workspaces={workspaces}
          projects={projects}
          sites={sites}
          onClose={() => setEditing(null)}
          onComplete={async (action, message) => {
            const ok = await run(action, message, editing === "transfer");
            if (ok) setEditing(null);
            return ok;
          }}
        />
      )}
      {systemAdmin && (
        <SystemDeviceConfig device={device} workspaces={workspaces} run={run} />
      )}
      <Panel className="section-gap danger-zone">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">危险操作</h2>
            <div className="panel-kicker">
              解绑后设备资产保留，但不再属于当前 Workspace
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
    </>
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
                  {item.label}
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
                  {item.label}
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
          <h3>Workspace 分配</h3>
          <label className="field">
            <span className="field-label">目标 Workspace</span>
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
      <h3>海康 / 萤石相机绑定</h3>
      {query.isLoading ? (
        <StateView
          type="loading"
          title="正在加载相机绑定"
          description="正在读取视频通道配置。"
        />
      ) : query.error ? (
        <StateView
          type="error"
          title="相机绑定加载失败"
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
                "相机绑定已更新",
              )
            }
          >
            保存相机绑定
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
            {device?.serial_no} · {device?.id}
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
        description="当前网关没有同 Workspace 且可访问的子设备。"
      />
    );
  return (
    <div className="child-device-list">
      {query.data.items.map(({ device }) => (
        <div key={device.id}>
          <div>
            <div className="cell-title">{device.name}</div>
            <div className="cell-sub mono">
              {device.serial_no} · {device.id}
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
  projects,
  sites,
  onClose,
  onComplete,
}: {
  device: Device;
  mode: Mode;
  currentWorkspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
  projects: JsonRecord[];
  sites: JsonRecord[];
  onClose: () => void;
  onComplete: (
    action: () => Promise<unknown>,
    message: string,
  ) => Promise<boolean>;
}) {
  const [projectId, setProjectId] = useState(device.project_id ?? "");
  const [siteId, setSiteId] = useState(device.site_id ?? "");
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
      if (mode === "placement")
        await onComplete(
          () =>
            api.devices.update(device.id, {
              project_id: projectId || null,
              site_id: siteId || null,
            }),
          "设备位置已更新",
        );
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
  const availableSites = sites.filter(
    (item) => !projectId || item.project_id === projectId,
  );
  return (
    <Panel className="section-gap device-editor">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            {mode === "placement"
              ? "调整 Project / Site"
              : mode === "calibration"
                ? "请求设备校准"
                : mode === "firmware"
                  ? "安排固件升级"
                  : "转移设备"}
          </h2>
          <div className="panel-kicker">
            {device.name} · {device.serial_no}
          </div>
        </div>
        <Button variant="secondary" onClick={onClose}>
          <X size={14} />
          关闭
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="device-form-grid">
          {mode === "placement" ? (
            <>
              <label className="field">
                <span className="field-label">Project</span>
                <select
                  value={projectId}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setSiteId("");
                  }}
                >
                  <option value="">不设置</option>
                  {projects.map((item) => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Site</span>
                <select
                  value={siteId}
                  disabled={!projectId}
                  onChange={(event) => setSiteId(event.target.value)}
                >
                  <option value="">不设置</option>
                  {availableSites.map((item) => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.name)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : mode === "calibration" ? (
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
                <span className="field-label">目标 Workspace</span>
                <select
                  required
                  value={targetWorkspaceId}
                  onChange={(event) => {
                    setTargetWorkspaceId(event.target.value);
                    setTargetProjectId("");
                    setTargetSiteId("");
                  }}
                >
                  <option value="">选择 Workspace</option>
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
                <span className="field-label">目标 Project</span>
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
                <span className="field-label">目标 Site</span>
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
                  我确认历史 Dataset 保留在原
                  Workspace，当前版本不会迁移历史数据集。
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
