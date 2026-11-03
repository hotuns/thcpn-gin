import { LoRaConnectionBadge, useLoRaGatewayStatus, gatewayStatusTime } from "./lorawan-gateway-status";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../../shared/hooks/use-mobile";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui";
import "./device-mobile.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Clock3, Eye, FileText, RefreshCw, ScanLine, Search, Settings2, X } from "lucide-react";
import { api, formatApiError, type Device, type DeviceTaxonomyTerm, type THCPNLatestAttributesResponse } from "@thcpn/api";
import { iconifyIconUrl } from "@thcpn/device-map";
import { useAuth } from "@thcpn/auth";
import { useLocale } from "@thcpn/i18n";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Input, Panel, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StateView, Table, Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui";
import {
  DEVICE_LIST_GC_TIME,
  DEVICE_LIST_STALE_TIME,
  DEVICE_MAP_STALE_TIME,
  DEVICE_RUNTIME_STALE_TIME,
  deviceListQueryKey,
} from "../../shared/data/device-list-cache";
import { type DeviceCategory, isTopLevelDevice, deviceCategory, matchesDeviceType, text, deviceModelLabel, relativeTime, overviewTime } from "./device-model";
import { DeviceVitalIndicators } from "./device-vital-indicators";
import { DeviceChildren } from "./device-children";

type Category = "all" | Exclude<DeviceCategory, "gateway_node">;

type FilterOption = { value: string; label: string };

const ALL_DEVICE_FILTER_VALUE = "__all_device_filter__";

function DeviceFilterSelect({ label, value, options, onChange }: { label: string; value: string; options: FilterOption[]; onChange: (value: string) => void }) {
  return (
    <div className="device-filter-select">
      <Select
        value={value || ALL_DEVICE_FILTER_VALUE}
        onValueChange={(next) => onChange(next === ALL_DEVICE_FILTER_VALUE ? "" : next)}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.value || ALL_DEVICE_FILTER_VALUE} value={item.value || ALL_DEVICE_FILTER_VALUE}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type ListMemory = { keyword: string; projectId: string; siteId: string; deviceTypeId: string; category: Category; expandedId: string; scrollY: number };
const emptyMemory: ListMemory = { keyword: "", projectId: "", siteId: "", deviceTypeId: "", category: "all", expandedId: "", scrollY: 0 };
const memoryKey = (workspaceId?: string | null) => `device-list:${workspaceId ?? "none"}`;
function readListMemory(workspaceId?: string | null): ListMemory {
  try {
    const saved = JSON.parse(sessionStorage.getItem(memoryKey(workspaceId)) ?? "null");
    if (!saved || !["all", "standalone", "gateway", "carbon_sink", "camera"].includes(saved.category)) return emptyMemory;
    return Object.fromEntries(Object.entries(emptyMemory).map(([key, fallback]) => [key, typeof saved[key] === typeof fallback ? saved[key] : fallback])) as ListMemory;
  } catch { return emptyMemory; }
}

export function DevicesPage() {
  const { currentId } = useWorkspace();
  // A workspace change must never reuse another workspace's filters or selection.
  return <DeviceList key={currentId ?? "none"} />;
}

function DeviceList() {
  const queryClient = useQueryClient();
  const { currentId } = useWorkspace();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listParams] = useSearchParams();
  const mobile = useIsMobile();
  const [saved] = useState(() => readListMemory(currentId));
  const [keyword, setKeyword] = useState(saved.keyword);
  const [projectId, setProjectId] = useState(saved.projectId);
  const [siteId, setSiteId] = useState(saved.siteId);
  const [deviceTypeId, setDeviceTypeId] = useState(saved.deviceTypeId);
  const [category, setCategory] = useState<Category>(saved.category);
  const [expandedId, setExpandedId] = useState(saved.expandedId);
  const scrollY = useRef(saved.scrollY);
  const restoredScroll = useRef(false);
  const persistList = () => {
    try { sessionStorage.setItem(memoryKey(currentId), JSON.stringify({ keyword, projectId, siteId, deviceTypeId, category, expandedId, scrollY: scrollY.current })); } catch { /* Browsing remains available when storage is blocked. */ }
  };
  useEffect(persistList, [currentId, keyword, projectId, siteId, deviceTypeId, category, expandedId]);
  const rememberScroll = () => { scrollY.current = window.scrollY; persistList(); };
  const openDevice = (id: string, tab?: string) => {
    rememberScroll();
    navigate(`/devices/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ""}`);
  };
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
    staleTime: DEVICE_MAP_STALE_TIME,
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
        .filter((device) => device.source_family === "thcpn" && !["camera", "carbon_sink"].includes(deviceCategory(device)))
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
    staleTime: DEVICE_RUNTIME_STALE_TIME,
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
          `${item.name} ${item.serial_no} ${item.id} ${(item.tags??[]).join(" ")}`
            .toLowerCase()
            .includes(keyword.toLowerCase()),
      ),
    [topLevelDevices, category, deviceTypeByDevice, deviceTypeId, keyword, tagsByDevice],
  );
  useEffect(() => {
    if (!query.data || restoredScroll.current) return;
    restoredScroll.current = true;
    if (scrollY.current > 0) {
      const frame = requestAnimationFrame(() => window.scrollTo({ top: scrollY.current }));
      return () => cancelAnimationFrame(frame);
    }
  }, [query.data]);
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
  const filterControls = (
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
              label="筛选生态分类"
              value={deviceTypeId}
              options={[
                { value: "", label: "全部生态分类" },
                ...(taxonomy.data?.items ?? [])
                  .filter((item) => item.kind === "ecosystem")
                  .map((item) => ({ value: item.id, label: item.name_zh })),
              ]}
              onChange={setDeviceTypeId}
            />
            {(projectId || siteId || deviceTypeId) && <button type="button" className="device-filter-reset" onClick={() => { setProjectId(""); setSiteId(""); setDeviceTypeId(""); }}><X size={13} />重置筛选</button>}
          </div>
  );
  const deviceRows = rows.map((device, index) => (
                  <DeviceRows
                    key={device.id}
                    device={device}
                    sequence={index + 1}
                    mobile={mobile}
                    deviceType={deviceTypeByDevice.get(device.id)}
                    workspaceId={currentId}
                    runtime={runtimeByDevice.get(device.id)}
                    runtimeLoading={runtime.isLoading}
                    tags={device.tags ?? []}
                    expanded={expandedId === device.id}
                    projectName={device.source_project_name || projectName(device.project_id)}
                    siteName={device.source_site_name || device.source_workspace_name || siteName(device.site_id)}
                    onExpand={() =>
                      setExpandedId(expandedId === device.id ? "" : device.id)
                    }
                    onOpen={(id = device.id, tab) =>
                      openDevice(id, tab)
                    }
                  />
                ));
  return (
    <>
      <Panel onClickCapture={(event) => { if ((event.target as HTMLElement).closest('a[href^="/devices/"]')) rememberScroll(); }}>
        {listParams.get("notice") && (
          <div className="command-note device-feedback">
            {listParams.get("notice")}
          </div>
        )}
        <div className="device-filter-bar" data-onboarding="device-filters">
          <div className="device-filter-main-row">
            <div className="filter-input">
              <Search size={15} />
              <Input
                type="search"
                aria-label="搜索设备"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索名称、序列号、ID 或标签"
              />
            </div>
            <div className="device-filter-actions">
              <Button variant="secondary" onClick={() => {
                void query.refetch();
                void queryClient.invalidateQueries({ predicate: query => ["lorawan-info","lorawan-connection","lorawan-activity"].some(key=>query.queryKey.includes(key)) });
                void mapQuery.refetch();
                if (runtimeDeviceIDs.length) void runtime.refetch();
              }}>
                <RefreshCw size={14} />
                刷新
              </Button>
              {!user?.is_demo && <Button data-onboarding="claim-entry" onClick={() => navigate("/claim")}>
                <ScanLine size={14} />
                添加设备
              </Button>}
            </div>
          </div>
          {mobile ? <Sheet><SheetTrigger asChild><Button variant="secondary">筛选 · {[projectId, siteId, deviceTypeId].filter(Boolean).length}</Button></SheetTrigger><SheetContent side="bottom" className="device-filter-sheet"><SheetHeader><SheetTitle>筛选设备</SheetTitle></SheetHeader>{filterControls}<SheetClose asChild><Button>完成筛选</Button></SheetClose></SheetContent></Sheet> : filterControls}
          {mobile && (projectId || siteId || deviceTypeId) && <div className="device-active-filters"><span>{[projectId && projectName(projectId), siteId && siteName(siteId), taxonomy.data?.items.find(item => item.id === deviceTypeId)?.name_zh].filter(Boolean).join(" · ")}</span><Button variant="ghost" onClick={() => { setProjectId(""); setSiteId(""); setDeviceTypeId(""); }}>重置筛选</Button></div>}
        </div>
        <Tabs value={category} onValueChange={(value) => setCategory(value as Category)}>
        <TabsList className="device-categories" aria-label="设备分类">
          {(
            [
              { id: "all", label: "全部" },
              { id: "standalone", label: "标准站" },
              { id: "gateway", label: "组网站" },
              { id: "carbon_sink", label: "碳汇站" },
              { id: "camera", label: "视频站" },
            ] as Array<{ id: Category; label: string }>
          ).map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className={category === item.id ? "active" : ""}
            >
              <span>{item.label}</span>
              <strong>{counts[item.id]}</strong>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={category} className="device-category-content" style={{ marginTop: 0 }}>
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
        ) : rows.length ? (mobile ? <div className="device-mobile-list">{deviceRows}</div> :
          <div className="table-wrap">
            <Table className="data-table device-table">
              <colgroup>
                <col className="device-table-sequence" />
                <col className="device-table-name" />
                <col className="device-table-vitals" />
                <col className="device-table-report" />
                <col className="device-table-assignment" />
                <col className="device-table-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">序号</th>
                  <th>设备</th>
                  <th>电量 / 信号</th>
                  <th>连接 / 最近活动</th>
                  <th>项目 / 站点</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {deviceRows}
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
        </TabsContent>
        </Tabs>
      </Panel>
    </>
  );
}

function DeviceRows({
  device,
  sequence,
  mobile,
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
  sequence: number;
  mobile: boolean;
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
  const { t, formatDateTime } = useLocale();
  const gateway = deviceCategory(device) === "gateway";
  const camera = deviceCategory(device) === "camera";
  const lora = device.source_family === "lorawan_v2";
  const gatewayStatus = useLoRaGatewayStatus(device.id,workspaceId,lora&&gateway);
  const gatewayInfo = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", device.id, "lorawan-info"),
    queryFn: () => api.devices.lorawanInfo(device.id),
    enabled: lora && gateway,
    staleTime:Infinity,refetchOnWindowFocus:false,
    retry:false,
  });
  if (mobile) return <article className="device-mobile-card">
    <div className="device-mobile-card-heading"><span className="device-mobile-sequence" aria-label={`序号 ${sequence}`}>{sequence}</span><button className="device-name-link" onClick={() => onOpen()}>{device.name}</button><Badge>{deviceModelLabel(device)}</Badge></div>
    <div className="device-mobile-meta">SN {device.serial_no}{deviceType ? ` · ${deviceType.name_zh}` : ""}</div>
    <div className="device-mobile-meta">{siteName} · {projectName}</div>
    <div className="device-mobile-status">{lora && gateway ? <><LoRaConnectionBadge connection={gatewayStatus.connection}/><span>{gatewayStatus.activity.error ? t("mobile.activityFailed") : gatewayStatus.activity.data?.last_received_at ? t("mobile.lastReceived", { time: formatDateTime(gatewayStatus.activity.data.last_received_at) }) : t("mobile.noReception")}</span></> : <span>{camera ? "视频设备" : runtime?.source_device.updated_at ? t("mobile.lastReported", { time: formatDateTime(runtime.source_device.updated_at) }) : t("mobile.noReport")}</span>}</div>
    {!camera && <DeviceVitalIndicators attributes={runtime?.attributes} batteryValue={lora ? gatewayInfo.data?.battery ?? null : undefined} signalValue={lora ? gatewayInfo.data?.cell ?? null : undefined} loading={lora ? gatewayInfo.isLoading : runtimeLoading} csq={deviceCategory(device) === "standalone"} signalCsq={lora || deviceCategory(device) === "standalone"} lithiumVoltage={lora || (device.source_family === "thcpn" && gateway)}/>}
    {tags.length > 0 && <div className="device-row-tags">{tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
    <div className="device-mobile-card-actions"><Button data-onboarding={camera ? undefined : "device-data-entry"} data-onboarding-route={camera ? undefined : `/devices/${encodeURIComponent(device.id)}?tab=data`} onClick={() => onOpen(undefined, camera ? "video" : "data")}><Eye size={16}/>{camera ? "查看视频" : "查看数据"}</Button>
      {gateway && <Button variant="secondary" aria-expanded={expanded} onClick={onExpand}>{expanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}{expanded ? "收起子节点" : "展开子节点"} · {device.child_count}</Button>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="secondary" aria-label={`${device.name} 更多操作`}>更多</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={() => onOpen(undefined, "profile")}>查看设备资料</DropdownMenuItem>{!camera && <DropdownMenuItem onSelect={() => onOpen(undefined, "config")}>查看设备配置</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
    </div>
    {expanded && <DeviceChildren workspaceId={workspaceId} deviceId={device.id} lora={lora} onData={(id) => onOpen(id, "data")}/>}
  </article>;
  return (
    <>
      <tr className={expanded ? "selected-row" : ""}>
        <td className="device-sequence-cell">{sequence}</td>
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
          {!camera?<DeviceVitalIndicators attributes={runtime?.attributes} batteryValue={lora ? gatewayInfo.data?.battery ?? null : undefined} signalValue={lora ? gatewayInfo.data?.cell ?? null : undefined} loading={lora ? gatewayInfo.isLoading : runtimeLoading} csq={deviceCategory(device) === "standalone"} signalCsq={lora || deviceCategory(device) === "standalone"} lithiumVoltage={device.source_family === "lorawan_v2" || (device.source_family === "thcpn" && ["gateway", "gateway_node"].includes(deviceCategory(device)))}/>:<span className="cell-sub">不适用</span>}
        </td>
        <td>
          {lora&&gateway?<div style={{display:"grid",gap:6}}><LoRaConnectionBadge connection={gatewayStatus.connection}/><span title={gatewayStatusTime(gatewayStatus.activity.data?.last_received_at)}>{gatewayStatus.activity.error?"活动读取失败":gatewayStatus.activity.data?.last_received_at?`接收于 ${relativeTime(gatewayStatus.activity.data.last_received_at)}`:"暂无接收"}</span></div>:!camera?<div className="device-last-report" title={overviewTime(runtime?.source_device.updated_at)}><Clock3 size={13}/><span>{runtime?.source_device.updated_at?relativeTime(runtime.source_device.updated_at):"暂无上报"}</span></div>:<span className="cell-sub">视频设备</span>}
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
          <td colSpan={6}>
            <DeviceChildren
              workspaceId={workspaceId}
              deviceId={device.id}
              lora={lora}
              onData={onOpen}
            />
          </td>
        </tr>
      )}
    </>
  );
}
