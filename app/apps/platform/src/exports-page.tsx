import { Fragment, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
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
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import {
  Badge,
  Button,
  ChoiceCard,
  DateTimeInput,
  EntityPicker,
  PageHeader,
  Panel,
  SearchInput,
  SelectInput,
  StateView,
  type PickerOption,
} from "@thcpn/ui";

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
): JsonRecord {
  return {
    resource_type: "device_batch",
    resource_id: deviceIds[0],
    export_type: system === "group" ? "group_site_zip" : "standard_station_zip",
    request_config: {
      device_ids: deviceIds,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      include_data: true,
      include_images: includeImages,
      ...(group ? { gateway_id: group.id, gateway_name: group.name } : {}),
    },
  };
}

export function ExportsPage() {
  const { currentId } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const requestedSystem = params.get("system") as ExportSystem | null;
  const [system, setSystem] = useState<ExportSystem | null>(
    ["standard", "group", "carbon"].includes(requestedSystem ?? "")
      ? requestedSystem
      : null,
  );
  const [mine, setMine] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [feedback, setFeedback] = useState("");
  const [downloading, setDownloading] = useState("");
  const [detailId, setDetailId] = useState("");
  const query = useQuery({
    queryKey: workspaceQueryKey(
      currentId,
      "exports",
      mine ? "mine" : "workspace",
    ),
    queryFn: () => api.exports.list(currentId!, mine, 500),
    enabled: Boolean(currentId),
    refetchInterval: 15_000,
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const jobs = useMemo(
    () =>
      (query.data?.items ?? []).filter(
        (item) => !statusFilter || item.status === statusFilter,
      ),
    [query.data, statusFilter],
  );
  const runCreate = async (payload: JsonRecord) => {
    setFeedback("");
    try {
      await api.exports.create(payload);
      setFeedback("导出任务已创建");
      setSystem(null);
      setParams({});
      await query.refetch();
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
  if (!currentId)
    return (
      <>
        <PageHeader
          eyebrow="工作区 / 数据导出"
          title="数据导出"
          description="请选择工作区后创建导出。"
        />
        <Panel>
          <StateView type="empty" title="请选择工作区" description="" />
        </Panel>
      </>
    );
  const all = query.data?.items ?? [];
  const active = all.filter((item) =>
    ["pending", "running"].includes(item.status),
  ).length;
  return (
    <div className="export-page">
      <PageHeader
        eyebrow="工作区 / 数据导出"
        title="数据导出"
        description="标准站、组网站和碳汇站使用各自的创建流程，任务统一在这里生成和下载。"
        actions={
          <div className="header-actions">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={14} />
              刷新
            </Button>
            <Button onClick={() => setSystem(system ? null : "standard")}>
              <Plus size={14} />
              {system ? "收起创建" : "新建导出"}
            </Button>
          </div>
        }
      />
      <div className="export-summary">
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
      {system === null ? null : (
        <div className="export-create-shell section-gap">
          <ExportSystemChooser selected={system} onSelect={setSystem} />
          {system === "standard" ? (
            <StandardExportForm
              devices={devices.data?.items ?? []}
              params={params}
              onClose={() => setSystem(null)}
              onCreate={runCreate}
            />
          ) : system === "group" ? (
            <GroupExportForm
              devices={devices.data?.items ?? []}
              params={params}
              onClose={() => setSystem(null)}
              onCreate={runCreate}
            />
          ) : (
            <CarbonExportForm
              devices={devices.data?.items ?? []}
              params={params}
              onClose={() => setSystem(null)}
              onCreate={runCreate}
            />
          )}
        </div>
      )}
      <Panel className="section-gap export-list-panel">
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
                工作区全部
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
            <table className="data-table export-jobs-table">
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
                        </td>
                        <td>
                          {displayTime(job.created_at)}
                          <div className="cell-sub">
                            过期：{displayTime(job.expires_at)}
                          </div>
                        </td>
                        <td>
                          <div className="table-actions">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setDetailId(expanded ? "" : job.id)
                              }
                            >
                              <ChevronDown size={13} />
                              {expanded ? "收起" : "详情"}
                            </Button>
                            {canDownloadExport(job) ? (
                              <Button
                                disabled={downloading === job.id}
                                onClick={() => void download(job)}
                              >
                                <Download size={13} />
                                {downloading === job.id
                                  ? "准备中…"
                                  : exportDownloadLabel()}
                              </Button>
                            ) : (
                              <span className="muted">
                                {["pending", "running"].includes(job.status)
                                  ? "正在生成"
                                  : job.status === "success"
                                    ? "文件已过期"
                                    : "不可下载"}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="export-detail-row">
                          <td colSpan={7}>
                            <ExportDetail job={job} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <StateView
            type="empty"
            title="暂无导出任务"
            description="创建任务后会显示在这里。"
          />
        )}
      </Panel>
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
    <div className="export-system-cards">
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
          <button
            key={item.id}
            className={selected === item.id ? "active" : ""}
            onClick={() => onSelect(item.id)}
          >
            <Icon size={18} />
            <strong>{item.title}</strong>
            <span>{item.text}</span>
          </button>
        );
      })}
    </div>
  );
}

type FormCommon = {
  params: URLSearchParams;
  onClose: () => void;
  onCreate: (payload: JsonRecord) => Promise<boolean>;
};
function RangeFields({
  start,
  end,
  setStart,
  setEnd,
}: {
  start: string;
  end: string;
  setStart: (v: string) => void;
  setEnd: (v: string) => void;
}) {
  const preset = () => {
    const range = defaultRange();
    setStart(range.start);
    setEnd(range.end);
  };
  return (
    <section className="export-range-section">
      <div className="export-range-head">
        <span>
          <strong>时间范围</strong>
          <small>默认查询当前时间往前 7 天</small>
        </span>
        <button type="button" onClick={preset}>
          <RefreshCw size={13} />
          恢复最近 7 天
        </button>
      </div>
      <div className="export-range-inputs">
        <DateTimeInput label="开始时间" value={start} onChange={setStart} />
        <span className="export-range-arrow">→</span>
        <DateTimeInput label="结束时间" value={end} onChange={setEnd} />
      </div>
    </section>
  );
}
function FormFooter({
  count,
  busy,
  onClose,
  label = "创建 ZIP 导出",
}: {
  count: number;
  busy: boolean;
  onClose: () => void;
  label?: string;
}) {
  return (
    <div className="form-actions">
      <span className="export-submit-summary">已选 {count} 项</span>
      <Button type="button" variant="secondary" onClick={onClose}>
        取消
      </Button>
      <Button type="submit" disabled={busy || count === 0}>
        {busy ? "创建中…" : label}
      </Button>
    </div>
  );
}

function StandardExportForm({
  devices,
  params,
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
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setSelected((now) =>
      now.includes(id) ? now.filter((item) => item !== id) : [...now, id],
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onCreate(
      buildBatchExportPayload("standard", selected, start, end, images),
    );
    setBusy(false);
  };
  return (
    <Panel className="export-system-form">
      <div className="panel-header">
        <div>
          <span className="export-form-icon">
            <Sprout size={17} />
          </span>
          <div>
            <h2 className="panel-title">标准站导出</h2>
            <div className="panel-kicker">选择一台或多台独立标准站</div>
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>
          <X size={14} />
          关闭
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="export-picker-layout">
          <EntityPicker
            label="标准站"
            icon={<Sprout size={16} />}
            options={pickerOptions(list)}
            selectedIds={selected}
            onChange={setSelected}
            mode="multiple"
            placeholder="请选择标准站"
            searchPlaceholder="搜索标准站名称或序列号"
          />
          <aside>
            <div>
              <strong>已选设备</strong>
              <span>{selected.length} 台</span>
            </div>
            {selected.length === 0 ? (
              <p>从左侧下拉列表选择设备</p>
            ) : (
              selected.map((id) => (
                <button type="button" key={id} onClick={() => toggle(id)}>
                  <span>
                    {value(
                      list.find((item) => value(item, "id") === id) ?? {},
                      "name",
                    ) || id}
                  </span>
                  <X size={13} />
                </button>
              ))
            )}
          </aside>
        </div>
        <RangeFields
          start={start}
          end={end}
          setStart={setStart}
          setEnd={setEnd}
        />
        <ChoiceCard
          checked={images}
          onChange={setImages}
          title="包含图片"
          description="同时打包设备图片与 image-index.csv"
        />
        <FormFooter count={selected.length} busy={busy} onClose={onClose} />
      </form>
    </Panel>
  );
}

function GroupExportForm({
  devices,
  params,
  onClose,
  onCreate,
}: { devices: JsonRecord[] } & FormCommon) {
  const gateways = devices.filter(
    (item) => value(item, "device_type") === "gateway",
  );
  const range = defaultRange();
  const [gatewayId, setGatewayId] = useState(params.get("gateway") ?? "");
  const [keyword, setKeyword] = useState("");
  const children = useQuery({
    queryKey: ["device", gatewayId, "children", "export"],
    queryFn: () => api.devices.children(gatewayId),
    enabled: Boolean(gatewayId),
  });
  const nodes = (children.data?.items ?? []).map(
    (item) => item.device as unknown as JsonRecord,
  );
  const filteredNodes = nodes.filter((item) =>
    `${value(item, "name")} ${value(item, "serial_no")}`
      .toLowerCase()
      .includes(keyword.toLowerCase()),
  );
  const requested = arrayParam(params.get("devices"));
  const [selected, setSelected] = useState<string[] | null>(
    requested.length ? requested : null,
  );
  const [start, setStart] = useState(params.get("start") ?? range.start);
  const [end, setEnd] = useState(params.get("end") ?? range.end);
  const [images, setImages] = useState(true);
  const [busy, setBusy] = useState(false);
  const chooseGateway = (id: string) => {
    setGatewayId(id);
    setSelected(null);
    setKeyword("");
  };
  const effective = selected ?? nodes.map((item) => value(item, "id"));
  const gateway = gateways.find((item) => value(item, "id") === gatewayId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onCreate(
      buildBatchExportPayload("group", effective, start, end, images, {
        id: gatewayId,
        name: value(gateway ?? {}, "name"),
      }),
    );
    setBusy(false);
  };
  return (
    <Panel className="export-system-form">
      <div className="panel-header">
        <div>
          <span className="export-form-icon">
            <Network size={17} />
          </span>
          <div>
            <h2 className="panel-title">组网站导出</h2>
            <div className="panel-kicker">一次选择一个组网站，再选择其节点</div>
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>
          <X size={14} />
          关闭
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="export-group-layout">
          <EntityPicker
            label="组网站"
            icon={<Network size={16} />}
            options={pickerOptions(gateways)}
            selectedIds={gatewayId ? [gatewayId] : []}
            onChange={(ids) => chooseGateway(ids[0] ?? "")}
            placeholder="请选择组网站"
            searchPlaceholder="搜索组网站名称或序列号"
          />
          <section className="export-target-picker">
            <SearchInput
              className="export-node-search"
              placeholder="搜索节点名称或序列号"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <div className="export-target-head">
              <span>
                节点 <strong>{effective.length}</strong> / {nodes.length}
              </span>
              {nodes.length > 0 && (
                <span className="export-target-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(nodes.map((item) => value(item, "id")))
                    }
                  >
                    全选
                  </button>
                  <button type="button" onClick={() => setSelected([])}>
                    清空
                  </button>
                </span>
              )}
            </div>
            <div className="export-device-checks">
              {filteredNodes.map((item) => {
                const id = value(item, "id");
                const checked = effective.includes(id);
                return (
                  <label key={id} className={checked ? "is-checked" : ""}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelected(
                          checked
                            ? effective.filter((x) => x !== id)
                            : [...effective, id],
                        )
                      }
                    />
                    <span className="export-check-mark">
                      {checked && <Check size={13} />}
                    </span>
                    <span>
                      <strong>{value(item, "name")}</strong>
                      <small>SN {value(item, "serial_no")}</small>
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
        <ChoiceCard
          checked={images}
          onChange={setImages}
          title="包含图片"
          description="按节点目录整理图片与索引"
        />
        <FormFooter count={effective.length} busy={busy} onClose={onClose} />
      </form>
    </Panel>
  );
}

function CarbonExportForm({
  devices,
  params,
  onClose,
  onCreate,
}: { devices: JsonRecord[] } & FormCommon) {
  const stations = devices.filter(
    (item) => value(item, "device_type") === "carbon_sink",
  );
  const range = defaultRange();
  const [deviceId, setDeviceId] = useState(params.get("device") ?? "");
  const metadata = useQuery({
    queryKey: ["device", deviceId, "metadata", "carbon-export"],
    queryFn: () => api.devices.metadata(deviceId),
    enabled: Boolean(deviceId),
  });
  const nodesCount = Number(
    metadata.data?.items.find((item) => item.key === "carbon_nodes_count")
      ?.value ?? 0,
  );
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
  const effectiveNodes = nodes ?? allNodes;
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
    <Panel className="export-system-form">
      <div className="panel-header">
        <div>
          <span className="export-form-icon">
            <Sprout size={17} />
          </span>
          <div>
            <h2 className="panel-title">碳汇站导出</h2>
            <div className="panel-kicker">
              组合选择 Node 与地块，生成一份 ZIP
            </div>
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>
          <X size={14} />
          关闭
        </Button>
      </div>
      <form onSubmit={submit}>
        <EntityPicker
          label="碳汇站"
          icon={<Sprout size={16} />}
          options={pickerOptions(stations)}
          selectedIds={deviceId ? [deviceId] : []}
          onChange={(ids) => {
            setDeviceId(ids[0] ?? "");
            setNodes(null);
          }}
          placeholder="请选择碳汇站"
          searchPlaceholder="搜索碳汇站名称或序列号"
        />
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
            <div className="export-chip-grid">
              {allNodes.map((id) => (
                <button
                  type="button"
                  className={effectiveNodes.includes(id) ? "active" : ""}
                  key={id}
                  onClick={() => toggleNode(id)}
                >
                  {effectiveNodes.includes(id) && <Check size={13} />}Node {id}
                </button>
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
            <div className="export-chip-grid">
              {["A", "B", "C", "D"].map((field) => (
                <button
                  type="button"
                  className={fields.includes(field) ? "active" : ""}
                  key={field}
                  onClick={() => toggleField(field)}
                >
                  {fields.includes(field) && <Check size={13} />}
                  <b>{field}</b> 地块
                </button>
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
                  fields.map((field) => `Node ${node}/${field}`).join("、"),
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
        <FormFooter
          count={effectiveNodes.length * fields.length}
          busy={busy}
          onClose={onClose}
        />
      </form>
    </Panel>
  );
}

function targetSummary(job: ExportJob, config: JsonRecord) {
  if (job.export_type === "carbon_station_zip")
    return `${Array.isArray(config.node_ids) ? config.node_ids.length : 0} 个 Node · ${Array.isArray(config.fields) ? config.fields.length : 0} 个地块`;
  if (job.resource_type === "dataset") return "1 个数据集";
  return `${Array.isArray(config.device_ids) ? config.device_ids.length : 1} 台设备`;
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
