import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Database,
  Download,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  formatApiError,
  type Dataset,
  type JsonRecord,
  type TelemetrySeries,
} from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";
import { TelemetryCharts } from "./telemetry-charts";
import { TelemetryTable } from "./telemetry-table";

type SourceInput = {
  source_type: Dataset["sources"][number]["source_type"];
  source_id: string;
};
type AddableSourceType = Extract<
  SourceInput["source_type"],
  "device" | "data_stream"
>;
type DatasetDraft = {
  workspaceId: string;
  projectId: string;
  name: string;
  description: string;
  dataType: string;
  startTime: string;
  endTime: string;
  sources: SourceInput[];
  status?: string;
};
const datasetTypeLabel = (value: Dataset["data_type"]) =>
  ({
    telemetry: "遥测数据",
    image: "图片",
    video: "视频",
    audio: "音频",
    event: "事件",
    log: "日志",
    mixed: "混合数据",
  })[value] ?? value;
const datasetStatusLabel = (value: Dataset["status"]) =>
  ({
    draft: "草稿",
    published: "已发布",
    locked: "已锁定",
    archived: "已归档",
  })[value] ?? value;
const sourceTypeLabel = (value: SourceInput["source_type"]) =>
  ({ device: "设备", data_stream: "数据指标", file: "文件" })[value] ?? value;
const localTime = (input: Date | string) => {
  const date = new Date(input);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const localTimeSeconds = (input: Date | string) => {
  const date = new Date(input);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19);
};
const displayTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(input))
    : "—";
export const buildDatasetPayload = (
  draft: DatasetDraft,
  editing = false,
): JsonRecord => ({
  ...(!editing
    ? {
        workspace_id: draft.workspaceId,
        ...(draft.projectId ? { project_id: draft.projectId } : {}),
      }
    : {}),
  name: draft.name.trim(),
  description: draft.description.trim(),
  data_type: draft.dataType,
  time_start: new Date(draft.startTime).toISOString(),
  time_end: new Date(draft.endTime).toISOString(),
  sources: draft.sources.map(({ source_type, source_id }) => ({
    source_type,
    source_id,
  })),
  ...(editing && draft.status ? { status: draft.status } : {}),
});
export const datasetDetailPath = (datasetId: string) =>
  `/datasets/${encodeURIComponent(datasetId)}`;
export const datasetEditPath = (datasetId: string) =>
  `${datasetDetailPath(datasetId)}/edit`;

export function DatasetsPage() {
  const { currentId } = useWorkspace();
  const navigate = useNavigate();
  const [projectFilter, setProjectFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [feedback, setFeedback] = useState("");
  const projects = useQuery({
    queryKey: workspaceQueryKey(currentId, "projects"),
    queryFn: () => api.projects.list(currentId!),
    enabled: Boolean(currentId),
  });
  const query = useQuery({
    queryKey: workspaceQueryKey(currentId, "datasets", projectFilter || "all"),
    queryFn: () => api.datasets.list(currentId!, projectFilter || undefined),
    enabled: Boolean(currentId),
  });
  const rows = useMemo(
    () =>
      (query.data?.items ?? []).filter((item) =>
        `${item.name} ${item.description ?? ""} ${item.id}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  const run = async (action: () => Promise<unknown>, message: string) => {
    setFeedback("");
    try {
      await action();
      setFeedback(message);
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
  if (!currentId)
    return (
      <>
        <PageHeader
          eyebrow="工作区 / 数据集"
          title="数据集"
          description="管理可复用的数据查询定义。"
        />
        <Panel>
          <StateView
            type="empty"
            title="请选择工作区"
            description="请先选择工作区，再查看数据集。"
          />
        </Panel>
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="工作区 / 数据集"
        title="数据集"
        description="将设备或数据流、时间范围和数据类型保存为可预览、分享与导出的查询定义。"
        actions={
          <div className="header-actions">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={14} />
              刷新
            </Button>
            <Button onClick={() => navigate("/datasets/new")}>
              <Plus size={14} />
              创建数据集
            </Button>
          </div>
        }
      />
      <Panel>
        <div className="dataset-toolbar">
          <div className="filter-input">
            <input
              aria-label="搜索数据集"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索名称、描述或 ID"
            />
          </div>
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="">全部项目</option>
            {projects.data?.items.map((item) => (
              <option key={String(item.id)} value={String(item.id)}>
                {String(item.name)}
              </option>
            ))}
          </select>
          <Badge tone="info">{rows.length} 个</Badge>
        </div>
        {feedback && (
          <div className="command-note dataset-feedback">{feedback}</div>
        )}
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载数据集"
            description="正在读取数据集定义。"
          />
        ) : query.error ? (
          <StateView
            type="error"
            title="数据集加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>数据集</th>
                  <th>类型</th>
                  <th>时间范围</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((dataset) => (
                  <tr key={dataset.id}>
                    <td>
                      <div className="cell-title">{dataset.name}</div>
                      <div className="cell-sub">
                        {dataset.description || "暂无描述"}
                      </div>
                      <div className="cell-sub mono">{dataset.id}</div>
                    </td>
                    <td>
                      <Badge tone="info">{datasetTypeLabel(dataset.data_type)}</Badge>
                    </td>
                    <td>
                      {displayTime(dataset.time_start)}
                      <div className="cell-sub">
                        至 {displayTime(dataset.time_end)}
                      </div>
                    </td>
                    <td>{dataset.sources.length} 个</td>
                    <td>
                      <Badge
                        tone={
                          dataset.status === "published"
                            ? "success"
                            : dataset.status === "locked"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {datasetStatusLabel(dataset.status)}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            navigate(datasetDetailPath(dataset.id))
                          }
                        >
                          <Eye size={13} />
                          查看详情
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => navigate(datasetEditPath(dataset.id))}
                        >
                          <Pencil size={13} />
                          编辑
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void run(
                              () =>
                                api.datasets.export(dataset.id, {
                                  export_type: "dataset_zip",
                                }),
                              "导出任务已创建",
                            )
                          }
                        >
                          <Download size={13} />
                          导出
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() =>
                            window.confirm(
                              `确认删除数据集“${dataset.name}”？`,
                            ) &&
                            void run(
                              () => api.datasets.remove(dataset.id),
                              "数据集已删除",
                            )
                          }
                        >
                          <Trash2 size={13} />
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StateView
            type="empty"
            title="暂无数据集"
            description={
              keyword || projectFilter
                ? "请调整筛选条件。"
                : "创建数据集后，可以复用查询范围并发起异步导出。"
            }
          />
        )}
      </Panel>
    </>
  );
}

export function DatasetDetailPage() {
  const { currentId } = useWorkspace();
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const dataset = useQuery({
    queryKey: workspaceQueryKey(currentId, "dataset", datasetId),
    queryFn: () => api.datasets.get(datasetId),
    enabled: Boolean(currentId && datasetId),
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const back = (
    <Button variant="secondary" onClick={() => navigate("/datasets")}>
      <ArrowLeft size={14} />
      返回数据集
    </Button>
  );
  if (!currentId)
    return (
      <>
        <PageHeader title="数据集详情" actions={back} />
        <Panel>
          <StateView type="empty" title="请选择工作区" description="请先选择工作区，再查看数据集详情。" />
        </Panel>
      </>
    );
  if (dataset.isLoading)
    return (
      <>
        <PageHeader title="数据集详情" actions={back} />
        <Panel>
          <StateView type="loading" title="正在加载数据集" description="正在读取数据集定义和数据来源。" />
        </Panel>
      </>
    );
  if (dataset.error || !dataset.data)
    return (
      <>
        <PageHeader title="数据集详情" actions={back} />
        <Panel>
          <StateView
            type="error"
            title="数据集加载失败"
            description={formatApiError(dataset.error).message}
            requestId={formatApiError(dataset.error).requestId}
            action={back}
          />
        </Panel>
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="工作区 / 数据集"
        title={dataset.data.name}
        description={dataset.data.description || "数据集元信息、来源和数据预览"}
        actions={
          <div className="header-actions">
            <Button
              variant="secondary"
              onClick={() => navigate(datasetEditPath(dataset.data.id))}
            >
              <Pencil size={14} />
              编辑
            </Button>
            {back}
          </div>
        }
      />
      <DatasetPreview dataset={dataset.data} devices={devices.data?.items ?? []} />
    </>
  );
}

export function DatasetEditorPage() {
  const { currentId } = useWorkspace();
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const creating = !datasetId;
  const dataset = useQuery({
    queryKey: workspaceQueryKey(currentId, "dataset", datasetId),
    queryFn: () => api.datasets.get(datasetId),
    enabled: Boolean(currentId && datasetId),
  });
  const projects = useQuery({
    queryKey: workspaceQueryKey(currentId, "projects"),
    queryFn: () => api.projects.list(currentId!),
    enabled: Boolean(currentId),
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const [feedback, setFeedback] = useState("");
  const returnPath = datasetId ? datasetDetailPath(datasetId) : "/datasets";
  const back = (
    <Button variant="secondary" onClick={() => navigate(returnPath)}>
      <ArrowLeft size={14} />
      {datasetId ? "返回详情" : "返回数据集"}
    </Button>
  );
  if (!currentId)
    return (
      <>
        <PageHeader title={creating ? "创建数据集" : "编辑数据集"} actions={back} />
        <Panel>
          <StateView type="empty" title="请选择工作区" description="请先选择工作区，再管理数据集。" />
        </Panel>
      </>
    );
  if (!creating && dataset.isLoading)
    return (
      <>
        <PageHeader title="编辑数据集" actions={back} />
        <Panel>
          <StateView type="loading" title="正在加载数据集" description="正在读取数据集定义和数据来源。" />
        </Panel>
      </>
    );
  if (!creating && (dataset.error || !dataset.data))
    return (
      <>
        <PageHeader title="编辑数据集" actions={back} />
        <Panel>
          <StateView
            type="error"
            title="数据集加载失败"
            description={formatApiError(dataset.error).message}
            requestId={formatApiError(dataset.error).requestId}
            action={back}
          />
        </Panel>
      </>
    );
  return (
    <>
      <PageHeader
        title={creating ? "创建数据集" : dataset.data?.name ?? "编辑数据集"}
        actions={back}
      />
      {feedback && <div className="command-note section-gap">{feedback}</div>}
      <DatasetForm
        key={dataset.data?.id ?? "create"}
        workspaceId={currentId}
        dataset={dataset.data ?? null}
        projects={projects.data?.items ?? []}
        devices={devices.data?.items ?? []}
        onClose={() => navigate(returnPath)}
        onSaved={async (action, message) => {
          setFeedback("");
          try {
            const saved = await action();
            navigate(datasetDetailPath(saved.id), { replace: true });
            return true;
          } catch (error) {
            const item = formatApiError(error);
            setFeedback(
              `${message}失败：${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
            );
            return false;
          }
        }}
      />
    </>
  );
}

function DatasetForm({
  workspaceId,
  dataset,
  projects,
  devices,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  dataset: Dataset | null;
  projects: JsonRecord[];
  devices: JsonRecord[];
  onClose: () => void;
  onSaved: (
    action: () => Promise<Dataset>,
    message: string,
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState(dataset?.name ?? "");
  const [description, setDescription] = useState(dataset?.description ?? "");
  const [projectId, setProjectId] = useState(dataset?.project_id ?? "");
  const [dataType, setDataType] = useState<Dataset["data_type"]>(
    dataset?.data_type ?? "telemetry",
  );
  const [startTime, setStartTime] = useState(
    localTime(dataset?.time_start ?? new Date(Date.now() - 86_400_000)),
  );
  const [endTime, setEndTime] = useState(
    localTime(dataset?.time_end ?? new Date()),
  );
  const [status, setStatus] = useState<Dataset["status"]>(
    dataset?.status ?? "draft",
  );
  const [sources, setSources] = useState<SourceInput[]>(
    () =>
      dataset?.sources.map((item) => ({
        source_type: item.source_type,
        source_id: item.source_id,
      })) ?? [],
  );
  const [sourceType, setSourceType] = useState<AddableSourceType>("device");
  const [deviceId, setDeviceId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const streams = useQuery({
    queryKey: ["device", deviceId, "streams", "dataset-form"],
    queryFn: () => api.dataStreams.list(deviceId),
    enabled: sourceType === "data_stream" && Boolean(deviceId),
  });
  useEffect(() => {
    setSourceId("");
  }, [deviceId, sourceType]);
  const addSource = () => {
    const id = sourceType === "device" ? deviceId : sourceId;
    if (
      !id ||
      sources.some(
        (item) => item.source_type === sourceType && item.source_id === id,
      )
    )
      return;
    setSources((current) => [
      ...current,
      { source_type: sourceType, source_id: id },
    ]);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sources.length) {
      setError("请至少添加一个设备或数据流来源");
      return;
    }
    if (new Date(startTime) >= new Date(endTime)) {
      setError("结束时间必须晚于开始时间");
      return;
    }
    setBusy(true);
    setError("");
    const draft = {
      workspaceId,
      projectId,
      name,
      description,
      dataType,
      startTime,
      endTime,
      sources,
      status,
    };
    try {
      const payload = buildDatasetPayload(draft, Boolean(dataset));
      await onSaved(
        () =>
          dataset
            ? api.datasets.update(dataset.id, payload)
            : api.datasets.create(payload),
        dataset ? "数据集已更新" : "数据集已创建",
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
    <Panel className="section-gap dataset-editor">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            {dataset ? "编辑数据集" : "创建数据集"}
          </h2>
          <div className="panel-kicker">
            选择可访问资源，不需要填写数据表或查询语句
          </div>
        </div>
        <Button variant="secondary" onClick={onClose}>
          <X size={14} />
          关闭
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="dataset-form-grid">
          <label className="field">
            <span className="field-label">名称</span>
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">项目</span>
            <select
              value={projectId}
              disabled={Boolean(dataset)}
              onChange={(event) => setProjectId(event.target.value)}
            >
            <option value="">不关联项目</option>
              {projects.map((item) => (
                <option key={String(item.id)} value={String(item.id)}>
                  {String(item.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">数据类型</span>
            <select
              value={dataType}
              onChange={(event) =>
                setDataType(event.target.value as Dataset["data_type"])
              }
            >
              {[
                "telemetry",
                "image",
                "video",
                "audio",
                "event",
                "log",
                "mixed",
              ].map((item) => (
                <option key={item} value={item}>
                  {datasetTypeLabel(item as Dataset["data_type"])}
                </option>
              ))}
            </select>
          </label>
          {dataset && (
            <label className="field">
              <span className="field-label">状态</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as Dataset["status"])
                }
              >
                {["draft", "published", "locked", "archived"].map((item) => (
                  <option key={item} value={item}>
                    {datasetStatusLabel(item as Dataset["status"])}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span className="field-label">开始时间</span>
            <input
              required
              type="datetime-local"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">结束时间</span>
            <input
              required
              type="datetime-local"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>
          <label className="field dataset-description">
            <span className="field-label">描述</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <div className="dataset-sources">
          <div>
            <h3>数据来源</h3>
            <span>{sources.length} 个已选择</span>
          </div>
          <div className="source-picker">
            <select
              value={sourceType}
              onChange={(event) =>
                setSourceType(event.target.value as AddableSourceType)
              }
            >
              <option value="device">整台设备</option>
              <option value="data_stream">单个数据指标</option>
            </select>
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            >
              <option value="">选择设备</option>
              {devices.map((item) => (
                <option key={String(item.id)} value={String(item.id)}>
                  {String(item.name)} · {String(item.serial_no)}
                </option>
              ))}
            </select>
            {sourceType === "data_stream" && (
              <select
                value={sourceId}
                disabled={!deviceId || streams.isLoading}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">
                  {streams.isLoading ? "正在加载数据指标" : "选择数据指标"}
                </option>
                {streams.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.code}
                  </option>
                ))}
              </select>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={
                !deviceId || (sourceType === "data_stream" && !sourceId)
              }
              onClick={addSource}
            >
              <Plus size={13} />
              添加来源
            </Button>
          </div>
          {sources.length ? (
            <div className="source-chips">
              {sources.map((source) => (
                <div
                  key={`${source.source_type}-${source.source_id}`}
                  title={source.source_id}
                >
                  <Database size={13} />
                  <SourceName source={source} devices={devices} />
                  <small>{sourceTypeLabel(source.source_type)}</small>
                  <button
                    type="button"
                    aria-label="移除来源"
                    onClick={() =>
                      setSources((current) =>
                        current.filter((item) => item !== source),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <StateView
              type="empty"
              title="尚未选择来源"
              description="可以添加整台设备，或先选择设备再添加具体数据流。"
            />
          )}
        </div>
        {error && <div className="form-error dataset-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={busy || !name.trim() || !sources.length}
          >
            {busy ? "保存中…" : "保存数据集"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function SourceName({
  source,
  devices,
}: {
  source: SourceInput;
  devices: JsonRecord[];
}) {
  const stream = useQuery({
    queryKey: ["data-stream", source.source_id, "source-name"],
    queryFn: () => api.dataStreams.get(source.source_id),
    enabled: source.source_type === "data_stream",
    staleTime: 60_000,
  });
  if (source.source_type === "device") {
    const device = devices.find((item) => String(item.id) === source.source_id);
    return (
      <span>
        {String(device?.name ?? device?.serial_no ?? "未知设备")}
      </span>
    );
  }
  if (source.source_type === "file") return <span>文件来源</span>;
  return (
    <span>
      {stream.isLoading
        ? "正在加载数据流…"
        : stream.data
          ? `${stream.data.name} · ${stream.data.code}`
          : "未命名数据指标"}
    </span>
  );
}

function DatasetPreview({
  dataset,
  devices,
}: {
  dataset: Dataset;
  devices: JsonRecord[];
}) {
  const [limit, setLimit] = useState(500);
  const [startTime, setStartTime] = useState(
    localTimeSeconds(dataset.time_start),
  );
  const [endTime, setEndTime] = useState(localTimeSeconds(dataset.time_end));
  const queryStart = new Date(
    Math.max(Date.parse(startTime), Date.parse(dataset.time_start)),
  ).toISOString();
  const queryEnd = new Date(
    Math.min(Date.parse(endTime), Date.parse(dataset.time_end)),
  ).toISOString();
  const previewable = ["telemetry", "mixed"].includes(dataset.data_type);
  const query = useQuery({
    queryKey: ["dataset", dataset.id, "preview", queryStart, queryEnd, limit],
    queryFn: () =>
      api.telemetry.dataset(dataset.id, {
        startTime: queryStart,
        endTime: queryEnd,
        limit,
      }),
    enabled: Boolean(
      previewable &&
        startTime &&
        endTime &&
        Date.parse(queryStart) < Date.parse(queryEnd),
    ),
  });
  const series = ((query.data as any)?.series ?? []) as TelemetrySeries[];
  const points = series
    .flatMap((item) => item.points.map((point) => ({ ...point, series: item })))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return (
    <Panel className="section-gap dataset-preview">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            数据预览
          </h2>
          <div className="panel-kicker">
            数据集时间范围、来源、趋势和明细
          </div>
        </div>
      </div>
      {previewable && <div className="dataset-preview-controls">
        <label className="field">
          <span className="field-label">开始时间</span>
          <input
            type="datetime-local"
            step="1"
            value={startTime}
            min={localTimeSeconds(dataset.time_start)}
            max={localTimeSeconds(dataset.time_end)}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">结束时间</span>
          <input
            type="datetime-local"
            step="1"
            value={endTime}
            min={localTimeSeconds(dataset.time_start)}
            max={localTimeSeconds(dataset.time_end)}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">每序列上限</span>
          <input
            type="number"
            min="1"
            max="5000"
            value={limit}
            onChange={(event) =>
              setLimit(
                Math.min(5000, Math.max(1, Number(event.target.value) || 1)),
              )
            }
          />
        </label>
      </div>}
      <div className="dataset-preview-meta">
        <div className="dataset-preview-summary">
          <span>
            <small>数据类型</small>
            <strong>{datasetTypeLabel(dataset.data_type)}</strong>
          </span>
          <span>
            <small>数据来源</small>
            <strong>{dataset.sources.length} 项</strong>
          </span>
          <span>
            <small>当前状态</small>
            <Badge
              tone={
                dataset.status === "locked" || dataset.status === "published"
                  ? "success"
                  : "neutral"
              }
            >
              {datasetStatusLabel(dataset.status)}
            </Badge>
          </span>
        </div>
        <details className="dataset-source-details">
          <summary>
            <span>
              <Database size={14} aria-hidden="true" />
              查看数据来源
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="dataset-source-list">
            {dataset.sources.map((source) => (
              <div
                key={`${source.source_type}-${source.source_id}`}
                title={source.source_id}
              >
                <Database size={13} aria-hidden="true" />
                <strong>
                  <SourceName source={source} devices={devices} />
                </strong>
                <small>{sourceTypeLabel(source.source_type)}</small>
              </div>
            ))}
          </div>
        </details>
      </div>
      {!previewable ? (
        <StateView
          type="empty"
          title="当前数据集没有遥测预览"
          description="此页面已展示数据集定义和来源；在线图表目前用于遥测和混合类型数据集。"
        />
      ) : new Date(startTime) >= new Date(endTime) ? (
        <StateView
          type="error"
          title="时间范围无效"
          description="结束时间必须晚于开始时间。"
        />
      ) : query.isLoading ? (
        <StateView
          type="loading"
          title="正在生成预览"
          description="正在读取并整理数据集遥测。"
        />
      ) : query.error ? (
        <StateView
          type="error"
          title="预览失败"
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
        />
      ) : series.some((item) => item.points.length) ? (
        <>
          <TelemetryCharts
            series={series}
            startTime={queryStart}
            endTime={queryEnd}
          />
          <div className="panel-header dataset-detail-header">
            <div>
              <h3 className="panel-title">遥测明细</h3>
              <div className="panel-kicker">每行一个采集时间，每列一个数据指标</div>
            </div>
            <Badge tone="neutral">{points.length} 条</Badge>
          </div>
          <TelemetryTable points={points} formatTime={displayTime} />
        </>
      ) : (
        <StateView
          type="empty"
          title="没有遥测数据"
          description="数据集可能只包含媒体来源，或所选时间内没有记录。"
        />
      )}
    </Panel>
  );
}
