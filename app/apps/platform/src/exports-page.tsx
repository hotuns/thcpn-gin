import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Download,
  FileArchive,
  Layers3,
  Network,
  Plus,
  RefreshCw,
  Sprout,
  X,
} from "lucide-react";
import {
  api,
  formatApiError,
  type ExportJob,
  type JsonRecord,
} from "@thcpn/api";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import {
  Badge,
  Button,
  CheckboxInput,
  PageHeader,
  Panel,
  SearchInput,
  SelectInput,
  StateView,
  Table,
  Tabs, TabsList, TabsTrigger,
  type PickerOption,
} from "./platform-ui";

import { DataRangeFields, validDataRange } from "./data-builder";
import { ExportDevicePicker, ExportContents, ExportContentToggle as ChoiceCard } from "./export-device-picker";
import { useLocale } from "@thcpn/i18n";

type ResourceType = "device" | "data_stream" | "dataset" | "media";
type ExportDraft = {
  resourceType: ResourceType;
  resourceId: string;
  exportType: string;
  startTime: string;
  endTime: string;
  limit: number;
  mediaType: string;
  expiresAt: string;
};
type ExportSystem = "standard" | "group" | "carbon";

const localTime = (input: Date | string) => {
  const date = new Date(input);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const defaultRange = () => ({
  start: localTime(new Date(Date.now() - 7 * 86_400_000)),
  end: localTime(new Date()),
});
const displayTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(input))
    : "—";
const value = (item: JsonRecord, key: string) => String(item[key] ?? "");
const pickerOptions = (items: JsonRecord[]): PickerOption[] =>
  items.map((item) => ({
    id: value(item, "id"),
    label: value(item, "name"),
    description: value(item, "serial_no"),
    searchText: Array.isArray(item.research_tags) ? item.research_tags.join(" ") : "",
  }));
const arrayParam = (input: string | null) =>
  input
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
const exportResourceLabel = (
  job: Pick<ExportJob, "export_type" | "resource_type">,
) =>
  String(job.export_type) === "group_site_zip"
    ? "组网站"
    : String(job.export_type) === "standard_station_zip"
      ? "标准站"
      : String(job.export_type) === "carbon_station_zip"
        ? "碳汇站"
        : job.resource_type === "dataset"
          ? "数据集"
          : "数据导出";
const exportDownloadLabel = () => "下载 ZIP";
export const exportTypesFor = (resource: ResourceType) =>
  resource === "dataset"
    ? ["dataset_zip"]
    : resource === "media"
      ? ["media_zip"]
      : ["telemetry_csv", "telemetry_excel", "media_zip"];
export const buildExportPayload = (draft: ExportDraft): JsonRecord => ({
  resource_type: draft.resourceType,
  resource_id: draft.resourceId,
  export_type: draft.exportType,
  ...(draft.exportType !== "dataset_zip"
    ? {
        start_time: new Date(draft.startTime).toISOString(),
        end_time: new Date(draft.endTime).toISOString(),
        limit: draft.limit,
      }
    : {}),
  ...(draft.exportType === "media_zip" && draft.mediaType
    ? { request_config: { media_type: draft.mediaType } }
    : {}),
  ...(draft.expiresAt
    ? { expires_at: new Date(draft.expiresAt).toISOString() }
    : {}),
});
export const canDownloadExport = (
  job: Pick<ExportJob, "status" | "expires_at">,
  now = Date.now(),
) => job.status === "success" && Date.parse(job.expires_at) > now;
export function buildBatchExportPayload(
  system: "standard" | "group",
  deviceIds: string[],
  startTime: string,
  endTime: string,
  includeImages = true,
  group?: { id: string; name: string },
  includeData = true,
): JsonRecord {
  return {
    resource_type: "device_batch",
    resource_id: deviceIds[0],
    export_type: system === "group" ? "group_site_zip" : "standard_station_zip",
    request_config: {
      device_ids: deviceIds,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      include_data: includeData,
      include_images: includeImages,
      ...(group ? { gateway_id: group.id, gateway_name: group.name } : {}),
    },
  };
}

export function ExportsPage({ creating = false }: { creating?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentId } = useWorkspace();
  const [params] = useSearchParams();
  const requestedSystem = params.get("system") as ExportSystem | null;
  const [system, setSystem] = useState<ExportSystem>(
    ["standard", "group", "carbon"].includes(requestedSystem ?? "")
      ? requestedSystem!
      : "standard",
  );
  const [mine, setMine] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [feedback, setFeedback] = useState(location.state?.exportCreated ? "导出任务已创建" : "");
  const [downloading, setDownloading] = useState("");
  const [retrying,setRetrying]=useState("");
  const [detailId, setDetailId] = useState("");
  const query = useQuery({
    queryKey: workspaceQueryKey(
      currentId,
      "exports",
      mine ? "mine" : "workspace",
    ),
    queryFn: () => api.exports.list(currentId!, mine, 500),
    enabled: Boolean(currentId) && !creating,
    refetchInterval: 15_000,
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId) && creating,
  });
  const deviceMap = useQuery({
    queryKey: workspaceQueryKey(currentId, "device-map", "true"),
    queryFn: () => api.devices.map(currentId!, true),
    enabled: Boolean(currentId) && creating,
  });
  const tagsByDevice = useMemo(
    () => new Map((deviceMap.data?.items ?? []).map((item) => [item.device_id, item.environment.research_tags])),
    [deviceMap.data?.items],
  );
  const exportDevices = useMemo(
    () => (devices.data?.items ?? []).map((item) => ({ ...item, research_tags: tagsByDevice.get(item.id) ?? [] })),
    [devices.data?.items, tagsByDevice],
  );
  const jobs = useMemo(
    () =>
      (query.data?.items ?? []).filter(
        (item) => !statusFilter || item.status === statusFilter,
      ),
    [query.data, statusFilter],
  );
  const retry = async (job:ExportJob) => {
    if (retrying) return;
    setRetrying(job.id);
    try {
      await api.exports.create({resource_type:job.resource_type,resource_id:job.resource_id,export_type:job.export_type,request_config:job.request_config ?? {}});
      await query.refetch();
    } catch(error) {setFeedback(formatApiError(error).message);} finally {setRetrying("");}
  };
  const runCreate = async (payload: JsonRecord) => {
    setFeedback("");
    try {
      await api.exports.create(payload);
      setFeedback("导出任务已创建");
      navigate("/exports", { replace: true, state: { exportCreated: true } });
      return true;
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
      return false;
    }
  };
  const download = async (job: ExportJob) => {
    setDownloading(job.id);
    setFeedback("");
    try {
      const result = await api.exports.download(job.id);
      const url = String(result.url ?? "");
      if (!url) throw new Error("服务端未返回下载地址");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.click();
    } catch (error) {
      setFeedback(formatApiError(error).message);
    } finally {
      setDownloading("");
    }
  };
  if (!creating && requestedSystem && ["standard", "group", "carbon"].includes(requestedSystem)) return <Navigate to={`/exports/new?${params.toString()}`} replace />;
  if (!currentId)
    return (
      <>
        <PageHeader
          eyebrow="组织 / 数据导出"
          title="数据导出"
          description="请选择组织后创建导出。"
        />
        <Panel>
          <StateView type="empty" title="请选择组织" description="" />
        </Panel>
      </>
    );
  const all = query.data?.items ?? [];
  const active = all.filter((item) =>
    ["pending", "running"].includes(item.status),
  ).length;
  return (
    <div className={`export-page${creating ? " dataset-editor-page export-editor-page" : ""}`}>
      <PageHeader
        eyebrow="组织 / 数据导出"
        title={creating ? "新建导出" : "数据导出"}
        description="标准站、组网站和碳汇站使用各自的创建流程，任务统一在这里生成和下载。"
        actions={
          <div className="header-actions">
            {creating ? <Button variant="secondary" onClick={() => navigate("/exports")}>返回导出列表</Button> : <>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={14} />
              刷新
            </Button>
            <Button data-onboarding="export-create" onClick={() => navigate("/exports/new")}>
              <Plus size={14} />
              新建导出
            </Button>
            </>}
          </div>
        }
      />
      <div className="export-summary" data-onboarding="export-summary" hidden={creating}>
        <div>
          <span className="export-summary-icon">
            <FileArchive size={16} />
          </span>
          <span>
            <small>全部任务</small>
            <strong>{all.length}</strong>
          </span>
        </div>
        <div>
          <span className="export-summary-icon is-running">
            <RefreshCw size={16} />
          </span>
          <span>
            <small>处理中</small>
            <strong>{active}</strong>
          </span>
        </div>
        <div>
          <span className="export-summary-icon is-success">
            <Check size={16} />
          </span>
          <span>
            <small>已完成</small>
            <strong>
              {all.filter((item) => item.status === "success").length}
            </strong>
          </span>
        </div>
        <div>
          <span className="export-summary-icon is-failed">
            <X size={16} />
          </span>
          <span>
            <small>失败</small>
            <strong>
              {all.filter((item) => item.status === "failed").length}
            </strong>
          </span>
        </div>
      </div>
      {feedback && <div className="command-note section-gap">{feedback}</div>}
      {creating && (
        <div className="export-create-shell section-gap">
          {system === "standard" ? (
            <StandardExportForm
              devices={exportDevices}
              chooser={<ExportSystemChooser selected={system} onSelect={setSystem} />}
              params={params}
              onClose={() => navigate("/exports")}
              onCreate={runCreate}
            />
          ) : system === "group" ? (
            <GroupExportForm
              devices={exportDevices}
              tagsByDevice={tagsByDevice}
              chooser={<ExportSystemChooser selected={system} onSelect={setSystem} />}
              params={params}
              onClose={() => navigate("/exports")}
              onCreate={runCreate}
            />
          ) : (
            <CarbonExportForm
              devices={exportDevices}
              chooser={<ExportSystemChooser selected={system} onSelect={setSystem} />}
              params={params}
              onClose={() => navigate("/exports")}
              onCreate={runCreate}
            />
          )}
        </div>
      )}
      {!creating && <Panel className="section-gap export-list-panel" data-onboarding="export-list">
        <div className="export-toolbar">
          <div>
            <div className="export-view-switch">
              <button
                className={mine ? "active" : ""}
                onClick={() => setMine(true)}
              >
                我的导出
              </button>
              <button
                className={!mine ? "active" : ""}
                onClick={() => setMine(false)}
              >
                组织全部
              </button>
            </div>
            <span className="export-list-count">共 {jobs.length} 个任务</span>
          </div>
          <div className="export-toolbar-filter">
            <span>任务状态</span>
            <SelectInput
              className="is-compact"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">全部状态</option>
              {["pending", "running", "success", "failed", "expired"].map(
                (item) => (
                  <option key={item} value={item}>
                    {item === "pending"
                      ? "排队中"
                      : item === "running"
                        ? "处理中"
                        : item === "success"
                          ? "已完成"
                          : item === "failed"
                            ? "失败"
                            : "已过期"}
                  </option>
                ),
              )}
            </SelectInput>
          </div>
        </div>
        {query.isLoading ? (
          <StateView type="loading" title="正在加载导出任务" description="" />
        ) : query.error ? (
          <StateView
            type="error"
            title="导出任务加载失败"
            description={formatApiError(query.error).message}
          />
        ) : jobs.length ? (
          <div className="table-wrap">
            <Table className="data-table export-jobs-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>设备体系</th>
                  <th>目标</th>
                  <th>时间范围</th>
                  <th>状态</th>
                  <th>创建 / 过期</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const expanded = detailId === job.id;
                  const config = (job.request_config ?? {}) as JsonRecord;
                  return (
                    <Fragment key={job.id}>
                      <tr>
                        <td className="mono">{job.id.slice(0, 12)}</td>
                        <td>{exportResourceLabel(job)}</td>
                        <td>{targetSummary(job, config)}</td>
                        <td>
                          {displayTime(String(config.start_time ?? ""))}
                          <div className="cell-sub">
                            至 {displayTime(String(config.end_time ?? ""))}
                          </div>
                        </td>
                        <td>
                          <ExportStatus status={job.status} />
                          {job.status === "running" && <ExportProgress job={job} />}
                        </td>
                        <td>
                          {displayTime(job.created_at)}
                          <div className="cell-sub">
                            过期：{displayTime(job.expires_at)}
                          </div>
                        </td>
                        <td>
                          <ExportRowActions job={job} expanded={expanded} downloading={downloading === job.id} retrying={!!retrying} onToggle={()=>setDetailId(expanded ? "" : job.id)} onDownload={()=>void download(job)} onRetry={()=>void retry(job)} />
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="export-detail-row">
                          <td colSpan={7} id={`export-detail-${job.id}`}>
                            <ExportDetail job={job} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : (
          <StateView
            type="empty"
            title="暂无导出任务"
            description="创建任务后会显示在这里。"
          />
        )}
      </Panel>}
    </div>
  );
}

function ExportSystemChooser({
  selected,
  onSelect,
}: {
  selected: ExportSystem;
  onSelect: (value: ExportSystem) => void;
}) {
  return (
    <section className="export-system-selector dataset-editor-section">
      <div className="dataset-editor-section-heading"><div className="dataset-step-heading"><span>1</span><div><h2>选择导出类型</h2><p>根据设备体系选择对应的导出方式</p></div></div></div>
      <Tabs value={selected} onValueChange={value => onSelect(value as ExportSystem)}>
      <TabsList className="export-system-tabs" aria-label="选择导出类型">
      {(
        [
          {
            id: "standard",
            title: "标准站导出",
            text: "批量选择独立标准站",
            icon: Sprout,
          },
          {
            id: "group",
            title: "组网站导出",
            text: "按一个组网站选择节点",
            icon: Network,
          },
          {
            id: "carbon",
            title: "碳汇站导出",
            text: "选择 Node × 地块组合",
            icon: Sprout,
          },
        ] as const
      ).map((item) => {
        const Icon = item.icon;
        return (
          <TabsTrigger
            key={item.id}
            value={item.id}
          >
            <Icon size={18} />
            <strong>{item.title}</strong>
          </TabsTrigger>
        );
      })}
      </TabsList>
      </Tabs>
    </section>
  );
}

type FormCommon = {
  chooser: ReactNode;
  params: URLSearchParams;
  onClose: () => void;
  onCreate: (payload: JsonRecord) => Promise<boolean>;
};
const RangeFields = DataRangeFields;
function FormFooter({
  count,
  busy,
  onClose,
  system,
  start,
  end,
  content,
  label = "创建 ZIP 导出",
  invalid = false,
}: {
  count: number;
  busy: boolean;
  onClose: () => void;
  system: string;
  start: string;
  end: string;
  content: string;
  label?: string;
  invalid?: boolean;
}) {
  const { t } = useLocale();
  const contentKeys: Record<string, string> = { "设备数据和图片": "dataImages", "设备数据": "dataOnly", "通量数据、原始采样": "fluxRaw", "通量数据": "flux", "原始采样": "raw", "图片": "imagesOnly", "未选择": "nothingSelected" };
  return (
    <aside className="export-builder-summary dataset-builder-summary">
      <div className="dataset-builder-summary-heading"><span>3</span><div><h2>检查并创建</h2><p>{t("exportEditor.after")}</p></div></div>
      <dl>
        <div><dt>导出类型</dt><dd>{system}</dd></div>
        <div><dt>导出目标</dt><dd>{count ? t("exportEditor.targets", { count }) : "未选择"}</dd></div>
        <div><dt>时间范围</dt><dd>{start.replace("T", " ")}<span>至</span>{end.replace("T", " ")}</dd></div>
        <div><dt>导出内容</dt><dd>{contentKeys[content] ? t(`exportEditor.${contentKeys[content]}`) : content}</dd></div>
      </dl>
      <div className="export-builder-actions">
        <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        <Button type="submit" disabled={busy || count === 0 || invalid || !validDataRange(start, end)}>{busy ? "创建中…" : label}</Button>
      </div>
      <p className="export-review-hint" role="status">{t(busy ? "exportEditor.creating" : !count ? "exportEditor.missing" : invalid ? "exportEditor.invalidSettings" : !validDataRange(start, end) ? "exportEditor.invalidRange" : "exportEditor.ready")}</p>
    </aside>
  );
}

function StandardExportForm({
  devices,
  params,
  chooser,
  onClose,
  onCreate,
}: { devices: JsonRecord[] } & FormCommon) {
  const list = devices.filter(
    (item) => value(item, "device_type") === "standalone",
  );
  const initial = arrayParam(params.get("devices"));
  const range = defaultRange();
  const [selected, setSelected] = useState<string[]>(initial);
  const [start, setStart] = useState(params.get("start") ?? range.start);
  const [end, setEnd] = useState(params.get("end") ?? range.end);
  const [images, setImages] = useState(true);
  const [data, setData] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !selected.length || (!data && !images) || !validDataRange(start, end)) return;
    setBusy(true);
    await onCreate(
      buildBatchExportPayload("standard", selected, start, end, images, undefined, data),
    );
    setBusy(false);
  };
  return (
    <div className="export-system-form">
      <form className="export-builder dataset-builder" onSubmit={submit}>
        <div className="export-builder-main dataset-builder-main">
          {chooser}
          <section className="dataset-editor-section export-settings-section">
      <div className="dataset-editor-section-heading">
        <div className="dataset-step-heading">
          <span className="export-form-icon">
            2
          </span>
          <div>
            <h2 className="panel-title">标准站导出</h2>
            <div className="panel-kicker">选择一台或多台独立标准站</div>
          </div>
        </div>
      </div>
        <div className="export-settings-fields">
        <div className="export-picker-layout">
          <ExportDevicePicker
            label="标准站"
            options={pickerOptions(list)}
            selectedIds={selected}
            onChange={setSelected}
            mode="multiple"
            searchPlaceholder="搜索标准站名称或序列号"
          />
        </div>
        <RangeFields
          start={start}
          end={end}
          setStart={setStart}
          setEnd={setEnd}
        />
        <ExportContents data={data} images={images} setData={setData} setImages={setImages} />
        </div>
          </section>
        </div>
        <FormFooter count={selected.length} busy={busy} onClose={onClose} system="标准站导出" start={start} end={end} content={data && images ? "设备数据和图片" : data ? "设备数据" : images ? "图片" : "未选择"} invalid={!data && !images} />
      </form>
    </div>
  );
}

function GroupExportForm({
  devices,
  tagsByDevice,
  params,
  chooser,
  onClose,
  onCreate,
}: { devices: JsonRecord[]; tagsByDevice: Map<string, string[]> } & FormCommon) {
  const gateways = devices.filter(
    (item) => value(item, "device_type") === "gateway",
  );
  const range = defaultRange();
  const [gatewayId, setGatewayId] = useState(params.get("gateway") ?? "");
  const [keyword, setKeyword] = useState("");
  const children = useQuery({
    queryKey: ["device", gatewayId, "nodes", "export"],
    queryFn: () => api.devices.nodes(gatewayId),
    enabled: Boolean(gatewayId),
  });
  const gateway = gateways.find((item) => value(item, "id") === gatewayId);
  const lorawan = value(gateway ?? {}, "source_family") === "lorawan_v2";
  const nodeItems = children.data?.items ?? [];
  const nodes = nodeItems.map((node) => ({ id: node.key, name: node.name, serial_no: node.target.kind === "device" ? `ID ${node.target.device_id.slice(0, 8)}` : `节点 ${node.target.node_index}` }));
  const filteredNodes = nodes.filter((item) =>
    `${value(item, "name")} ${value(item, "serial_no")} ${(tagsByDevice.get(value(item, "id")) ?? []).join(" ")}`
      .toLowerCase()
      .includes(keyword.toLowerCase()),
  );
  const requested = arrayParam(params.get("nodes"));
  const [selected, setSelected] = useState<string[] | null>(
    requested.length ? requested : null,
  );
  const [start, setStart] = useState(params.get("start") ?? range.start);
  const [end, setEnd] = useState(params.get("end") ?? range.end);
  const [images, setImages] = useState(true);
  const [data, setData] = useState(true);
  const [busy, setBusy] = useState(false);
  const chooseGateway = (id: string) => {
    setGatewayId(id);
    setSelected(null);
    setKeyword("");
  };
  const effective = (selected ?? nodes.map((item) => value(item, "id"))).filter(id => nodes.some(node => node.id === id));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !effective.length || (!data && (lorawan || !images)) || !validDataRange(start, end)) return;
    setBusy(true);
    const chosen = nodeItems.filter((node) => effective.includes(node.key));
    const ids = [...new Set(chosen.map((node) => node.target.kind === "device" ? node.target.device_id : node.target.gateway_device_id))];
    const payload = buildBatchExportPayload("group", ids, start, end, !lorawan && images, {
        id: gatewayId,
        name: value(gateway ?? {}, "name"),
      }, data);
    (payload.request_config as JsonRecord).node_targets = chosen.map((node) => node.target);
    await onCreate(payload);
    setBusy(false);
  };
  return (
    <div className="export-system-form">
      <form className="export-builder dataset-builder" onSubmit={submit}>
        <div className="export-builder-main dataset-builder-main">
          {chooser}
          <section className="dataset-editor-section export-settings-section">
      <div className="dataset-editor-section-heading">
        <div className="dataset-step-heading">
          <span className="export-form-icon">
            2
          </span>
          <div>
            <h2 className="panel-title">组网站导出</h2>
            <div className="panel-kicker">一次选择一个组网站，再选择其节点</div>
          </div>
        </div>
      </div>
        <div className="export-settings-fields">
        <div className="export-group-layout">
          <ExportDevicePicker
            label="组网站"
            options={pickerOptions(gateways)}
            selectedIds={gatewayId ? [gatewayId] : []}
            onChange={(ids) => chooseGateway(ids[0] ?? "")}
            searchPlaceholder="搜索组网站名称或序列号"
          />
          <section className="export-target-picker">
            {(nodes.length > 5 || keyword) && <SearchInput
              className="export-node-search"
              aria-label="搜索节点名称或序列号"
              placeholder="搜索节点名称或序列号"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />}
            <div className="export-target-head">
              <span>
                节点 <strong>{effective.length}</strong> / {nodes.length}
              </span>
              {nodes.length > 0 && (
                <span className="export-target-actions">
                  <Button variant="ghost"
                    type="button"
                    onClick={() =>
                      setSelected(nodes.map((item) => value(item, "id")))
                    }
                  >
                    全选
                  </Button>
                  <Button variant="ghost" type="button" onClick={() => setSelected([])}>
                    清空
                  </Button>
                </span>
              )}
            </div>
            {children.error && <Alert variant="destructive" className="request-error-inline"><AlertTitle>设备数据加载失败</AlertTitle><AlertDescription><p>{formatApiError(children.error).message}</p></AlertDescription></Alert>}
            {!gatewayId ? <p className="data-builder-empty">请先选择组网站</p> : children.isLoading ? <p className="data-builder-empty">正在加载节点…</p> : !children.error && !filteredNodes.length ? <p className="data-builder-empty">没有匹配的节点</p> : null}
            <div className="export-device-checks">
              {filteredNodes.map((item) => {
                const id = value(item, "id");
                const checked = effective.includes(id);
                return (
                  <label key={id} className={checked ? "is-checked" : ""}>
                    <CheckboxInput
                      checked={checked}
                      onChange={() =>
                        setSelected(
                          checked
                            ? effective.filter((x) => x !== id)
                            : [...effective, id],
                        )
                      }
                    />
                    <span>
                      <strong>{value(item, "name")}</strong>
                      {value(item, "serial_no") && <small>{value(item, "serial_no")}</small>}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>
        <RangeFields
          start={start}
          end={end}
          setStart={setStart}
          setEnd={setEnd}
        />
        <ExportContents data={data} images={!lorawan && images} setData={setData} setImages={setImages} imagesAvailable={!lorawan} />
        </div>
          </section>
        </div>
        <FormFooter count={effective.length} busy={busy} onClose={onClose} system="组网站导出" start={start} end={end} content={data && !lorawan && images ? "设备数据和图片" : data ? "设备数据" : !lorawan && images ? "图片" : "未选择"} invalid={!data && (lorawan || !images)} />
      </form>
    </div>
  );
}

function CarbonExportForm({
  devices,
  params,
  chooser,
  onClose,
  onCreate,
}: { devices: JsonRecord[] } & FormCommon) {
  const stations = devices.filter(
    (item) => value(item, "device_type") === "carbon_sink",
  );
  const range = defaultRange();
  const [deviceId, setDeviceId] = useState(params.get("device") ?? "");
  const overview = useQuery({
    queryKey: ["carbon", deviceId, "overview"],
    queryFn: () => api.carbon.overview(deviceId),
    enabled: Boolean(deviceId),
  });
  const nodesCount = overview.data?.nodes_count ?? 0;
  const allNodes = Array.from({ length: nodesCount }, (_, i) => i + 1);
  const requestedNodes = arrayParam(params.get("nodes"))
    .map(Number)
    .filter((item) => item > 0);
  const [nodes, setNodes] = useState<number[] | null>(
    requestedNodes.length ? requestedNodes : null,
  );
  const [fields, setFields] = useState<string[]>(["A", "B", "C", "D"]);
  const [start, setStart] = useState(params.get("start") ?? range.start);
  const [end, setEnd] = useState(params.get("end") ?? range.end);
  const [flux, setFlux] = useState(true);
  const [raw, setRaw] = useState(true);
  const [busy, setBusy] = useState(false);
  const effectiveNodes = (nodes ?? allNodes).filter(id => allNodes.includes(id));
  const toggleField = (field: string) =>
    setFields((now) =>
      now.includes(field)
        ? now.filter((item) => item !== field)
        : [...now, field],
    );
  const toggleNode = (id: number) =>
    setNodes((now) =>
      effectiveNodes.includes(id)
        ? effectiveNodes.filter((item) => item !== id)
        : [...effectiveNodes, id],
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !validDataRange(start, end)) return;
    if (!effectiveNodes.length || !fields.length || (!flux && !raw) || overview.isLoading || overview.error) return;
    setBusy(true);
    await onCreate({
      resource_type: "device",
      resource_id: deviceId,
      export_type: "carbon_station_zip",
      request_config: {
        node_ids: effectiveNodes,
        fields,
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        include_flux: flux,
        include_raw_samples: raw,
      },
    });
    setBusy(false);
  };
  return (
    <div className="export-system-form">
      <form className="export-builder dataset-builder" onSubmit={submit}>
        <div className="export-builder-main dataset-builder-main">
          {chooser}
          <section className="dataset-editor-section export-settings-section">
      <div className="dataset-editor-section-heading">
        <div className="dataset-step-heading">
          <span className="export-form-icon">
            2
          </span>
          <div>
            <h2 className="panel-title">碳汇站导出</h2>
            <div className="panel-kicker">
              组合选择 Node 与地块，生成一份 ZIP
            </div>
          </div>
        </div>
      </div>
        <div className="export-settings-fields">
        <ExportDevicePicker
          label="碳汇站"
          options={pickerOptions(stations)}
          selectedIds={deviceId ? [deviceId] : []}
          onChange={(ids) => {
            setDeviceId(ids[0] ?? "");
            setNodes(null);
          }}
          searchPlaceholder="搜索碳汇站名称或序列号"
        />
        {overview.error && <StateView type="error" title="设备数据加载失败" description={formatApiError(overview.error).message} />}
        <div className="carbon-export-selector">
          <section>
            <div className="export-selector-title">
              <span>
                <strong>Node</strong>
                <small>默认全选该站全部节点</small>
              </span>
              <em>
                {effectiveNodes.length}/{allNodes.length}
              </em>
            </div>
            <div className="export-option-checks">
              {allNodes.map((id) => (
                <label
                  className={effectiveNodes.includes(id) ? "active" : ""}
                  key={id}
                >
                  <CheckboxInput checked={effectiveNodes.includes(id)} onChange={() => toggleNode(id)} />{overview.data?.nodes.find(node => node.node_id === id)?.name ?? `节点 ${id}`}
                </label>
              ))}
            </div>
          </section>
          <section>
            <div className="export-selector-title">
              <span>
                <strong>地块</strong>
                <small>用户可移除不需要的地块</small>
              </span>
              <em>{fields.length}/4</em>
            </div>
            <div className="export-option-checks">
              {["A", "B", "C", "D"].map((field) => (
                <label
                  className={fields.includes(field) ? "active" : ""}
                  key={field}
                >
                  <CheckboxInput checked={fields.includes(field)} onChange={() => toggleField(field)} />
                  <b>{field}</b> 地块
                </label>
              ))}
            </div>
          </section>
        </div>
        <div className="carbon-export-matrix">
          <span className="export-matrix-icon">
            <Layers3 size={17} />
          </span>
          <span>
            <strong>
              将生成 {effectiveNodes.length * fields.length} 个 Node × 地块组合
            </strong>
            <small>
              {effectiveNodes
                .map((node) =>
                  fields.map((field) => `${overview.data?.nodes.find(item => item.node_id === node)?.name ?? `节点 ${node}`}/${field}`).join("、"),
                )
                .join("；") || "请选择组合"}
            </small>
          </span>
        </div>
        <RangeFields
          start={start}
          end={end}
          setStart={setStart}
          setEnd={setEnd}
        />
        <div className="export-content-section">
          <div>
            <strong>导出内容</strong>
            <span>至少选择一种数据内容</span>
          </div>
          <div className="export-content-checks">
            <ChoiceCard
              checked={flux}
              onChange={setFlux}
              title="通量数据"
              description="NEE、ER、GPP"
            />
            <ChoiceCard
              checked={raw}
              onChange={setRaw}
              title="原始采样"
              description="周期与原始记录"
            />
          </div>
        </div>
        </div>
          </section>
        </div>
        <FormFooter
          invalid={(!flux && !raw) || overview.isLoading || Boolean(overview.error)}
          count={effectiveNodes.length * fields.length}
          busy={busy}
          onClose={onClose}
          system="碳汇站导出"
          start={start}
          end={end}
          content={[flux ? "通量数据" : "", raw ? "原始采样" : ""].filter(Boolean).join("、") || "未选择"}
        />
      </form>
    </div>
  );
}

function targetSummary(job: ExportJob, config: JsonRecord) {
  if (job.export_type === "carbon_station_zip")
    return `${Array.isArray(config.node_ids) ? config.node_ids.length : 0} 个 Node · ${Array.isArray(config.fields) ? config.fields.length : 0} 个地块`;
  if (job.resource_type === "dataset") return "1 个数据集";
  return `${Array.isArray(config.device_ids) ? config.device_ids.length : 1} 台设备`;
}
export function ExportProgress({job}:{job:ExportJob}) {
  const {t}=useLocale();
  const progress=job.progress;
  if (!progress?.stage) return null;
  return <div className="cell-sub" role="status">{t(progress.stage === "uploading" ? "exportEditor.uploadingProgress" : "exportEditor.packingProgress", {count:progress.packed_images ?? 0, size: `${((progress.packed_bytes ?? 0)/1048576).toFixed(1)} MB`})}</div>;
}
function RetryExportButton({busy,onRetry}:{busy:boolean;onRetry:()=>void}){
  const {t}=useLocale();return <Button variant="secondary" disabled={busy} onClick={onRetry}><RefreshCw size={13}/>{t("exportEditor.retry")}</Button>;
}
export function ExportRowActions({job,expanded,downloading,retrying,onToggle,onDownload,onRetry}:{job:ExportJob;expanded:boolean;downloading:boolean;retrying:boolean;onToggle:()=>void;onDownload:()=>void;onRetry:()=>void}) {
  const available=canDownloadExport(job);
  const unavailable=["pending","running"].includes(job.status) ? "正在生成" : job.status === "success" ? "文件已过期" : "不可下载";
  return <div className="table-actions export-row-actions">
    <Button variant="secondary" aria-expanded={expanded} aria-controls={`export-detail-${job.id}`} onClick={onToggle}><ChevronDown size={13}/>{expanded ? "收起" : "详情"}</Button>
    <Button variant="secondary" disabled={!available || downloading} onClick={onDownload}><Download size={13}/>{available ? downloading ? "准备中…" : exportDownloadLabel() : unavailable}</Button>
    {job.status === "failed" && <RetryExportButton busy={retrying} onRetry={onRetry}/>}
  </div>;
}
function ExportStatus({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "success"
      : status === "failed"
        ? "danger"
        : ["pending", "running"].includes(status)
          ? "warning"
          : "neutral";
  const label =
    status === "pending"
      ? "排队中"
      : status === "running"
        ? "处理中"
        : status === "success"
          ? "已完成"
          : status === "failed"
            ? "失败"
            : "已过期";
  return <Badge tone={tone}>{label}</Badge>;
}
function ExportDetail({ job }: { job: ExportJob }) {
  const config = (job.request_config ?? {}) as JsonRecord;
  return (
    <div className="export-detail">
      <div className="export-detail-grid">
        <div>
          <span>设备体系</span>
          <strong>{exportResourceLabel(job)}</strong>
        </div>
        <div>
          <span>目标</span>
          <strong>{targetSummary(job, config)}</strong>
        </div>
        <div>
          <span>创建时间</span>
          <strong>{displayTime(job.created_at)}</strong>
        </div>
        <div>
          <span>完成时间</span>
          <strong>{displayTime(job.finished_at)}</strong>
        </div>
        <div>
          <span>过期时间</span>
          <strong>{displayTime(job.expires_at)}</strong>
        </div>
      </div>
      {job.error_message && (
        <div className="form-error">{job.error_message}</div>
      )}
      <div className="export-config">
        <h3>ZIP 基础内容</h3>
        <div>
          <span>清单</span>
          <strong>manifest.csv</strong>
        </div>
        <div>
          <span>生成情况</span>
          <strong>generation-report.csv</strong>
        </div>
        <div>
          <span>说明</span>
          <strong>README.txt</strong>
        </div>
      </div>
    </div>
  );
}
