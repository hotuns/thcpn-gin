import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Database,
  Download,
  Eye,
  GitCompareArrows,
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
import { Badge, Button, IconButton, PageHeader, Panel, StateView } from "@thcpn/ui";
import { TelemetryCharts } from "./telemetry-charts";
import { TelemetryTable } from "./telemetry-table";
import { dataComparisonPath } from "./data-workflow";

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
type DatasetPrefill = {
  name: string;
  startTime: string;
  endTime: string;
  sources: SourceInput[];
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
const datasetDeviceSystem = (item?: JsonRecord) => {
  const type = String(item?.device_type ?? "");
  return type === "standalone" ? "standard" : type === "gateway_node" ? "group" : "";
};
const localTime = (input: Date | string) => {
  const date = new Date(input);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const displayTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
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
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
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
                      <button
                        type="button"
                        className="dataset-title-link"
                        onClick={() => navigate(datasetDetailPath(dataset.id))}
                      >
                        {dataset.name}
                      </button>
                      <div className="cell-sub">
                        {dataset.description || "暂无描述"}
                      </div>
                      <div className="cell-sub">
                        项目：{String(projects.data?.items.find((item) => item.id === dataset.project_id)?.name ?? "未关联项目")}
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
                    <td>
                      <DatasetSourceSummary
                        sources={dataset.sources}
                        devices={devices.data?.items ?? []}
                      />
                    </td>
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
                        <IconButton
                          label="编辑数据集"
                          onClick={() => navigate(datasetEditPath(dataset.id))}
                        >
                          <Pencil size={13} />
                        </IconButton>
                        <IconButton
                          label="导出数据集"
                          onClick={() =>
                            (async () => {
                              const created = await run(
                                () =>
                                  api.datasets.export(dataset.id, {
                                    export_type: "dataset_zip",
                                  }),
                                "导出任务已创建",
                              );
                              if (created) navigate("/exports");
                            })()
                          }
                        >
                          <Download size={13} />
                        </IconButton>
                        <IconButton
                          label="删除数据集"
                          className="dataset-delete-action"
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
                        </IconButton>
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
  const [actionError, setActionError] = useState("");
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
  const projects = useQuery({
    queryKey: workspaceQueryKey(currentId, "projects"),
    queryFn: () => api.projects.list(currentId!),
    enabled: Boolean(currentId),
  });
  const comparableSources = (dataset.data?.sources ?? [])
    .filter((source) => source.source_type !== "file")
    .slice(0, 8);
  const comparisonSources = useQueries({
    queries: comparableSources.map((source) => ({
      queryKey: workspaceQueryKey(
        currentId,
        "dataset-comparison-source",
        source.source_type,
        source.source_id,
      ),
      queryFn: async () => {
        if (source.source_type === "data_stream") {
          return [await api.dataStreams.get(source.source_id)];
        }
        const response = await api.dataStreams.list(source.source_id);
        return response.items.filter(
          (stream) => stream.type === "telemetry" && stream.status === "active",
        );
      },
      enabled: Boolean(currentId && dataset.data),
      staleTime: 60_000,
    })),
  });
  const comparisonSeeds = comparisonSources
    .flatMap((query) => query.data ?? [])
    .map((stream) => ({
      deviceId: stream.device_id,
      streamId: stream.id,
    }))
    .filter(
      (seed, index, items) =>
        items.findIndex((item) => item.streamId === seed.streamId) === index,
    )
    .slice(0, 8);
  const comparisonLoading = comparisonSources.some(
    (query) => query.isLoading || query.isFetching,
  );
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
            {["telemetry", "mixed"].includes(dataset.data.data_type) && (
              <Button
                variant="secondary"
                disabled={comparisonLoading || !comparisonSeeds.length}
                onClick={() =>
                  navigate(
                    dataComparisonPath(
                      comparisonSeeds,
                      localTime(dataset.data.time_start),
                      localTime(dataset.data.time_end),
                    ),
                  )
                }
              >
                <GitCompareArrows size={14} />
                {comparisonLoading ? "准备对比…" : "在数据对比中打开"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={async () => {
                setActionError("");
                try {
                  await api.datasets.export(dataset.data.id, {
                    export_type: "dataset_zip",
                  });
                  navigate("/exports");
                } catch (error) {
                  const item = formatApiError(error);
                  setActionError(
                    `创建导出任务失败：${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
                  );
                }
              }}
            >
              <Download size={14} />
              导出
            </Button>
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
      {actionError && <div className="command-note section-gap">{actionError}</div>}
      <DatasetPreview
        key={dataset.data.id}
        dataset={dataset.data}
        devices={devices.data?.items ?? []}
        projectName={projects.data?.items.find((item) => item.id === dataset.data?.project_id)?.name}
      />
    </>
  );
}

export function DatasetEditorPage() {
  const { currentId } = useWorkspace();
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const creating = !datasetId;
  const [formBusy, setFormBusy] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const prefill = useMemo<DatasetPrefill | undefined>(() => {
    if (!creating) return undefined;
    const sources = (searchParams.get("sources") ?? "")
      .split(",")
      .map((sourceId) => sourceId.trim())
      .filter(Boolean)
      .slice(0, 32)
      .map((sourceId) => ({
        source_type: "data_stream" as const,
        source_id: sourceId,
      }));
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    return {
      name: searchParams.get("name") ?? "",
      startTime:
        start && Number.isFinite(Date.parse(start))
          ? localTime(start)
          : localTime(new Date(Date.now() - 86_400_000)),
      endTime:
        end && Number.isFinite(Date.parse(end))
          ? localTime(end)
          : localTime(new Date()),
      sources,
    };
  }, [creating, searchParams]);
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
  const requestBack = () => {
    if (formDirty && !window.confirm("当前数据集有未保存修改，确定离开吗？")) return;
    navigate(returnPath);
  };
  const back = (
    <Button variant="secondary" onClick={requestBack}>
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
        eyebrow="工作区 / 数据集"
        title={creating ? "创建数据集" : dataset.data?.name ?? "编辑数据集"}
        description={creating ? "定义数据来源、时间范围和数据类型。" : "修改数据集定义；预览页面只展示已保存的范围。"}
        actions={
          <div className="header-actions">
            <Button type="submit" form="dataset-form" disabled={formBusy}>
              {formBusy ? "保存中…" : "保存数据集"}
            </Button>
            {back}
          </div>
        }
      />
      {feedback && <div className="command-note section-gap">{feedback}</div>}
      <DatasetForm
        key={dataset.data?.id ?? (searchParams.toString() || "create")}
        workspaceId={currentId}
        dataset={dataset.data ?? null}
        prefill={prefill}
        projects={projects.data?.items ?? []}
        devices={devices.data?.items ?? []}
        onBusyChange={setFormBusy}
        onDirtyChange={setFormDirty}
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
  prefill,
  projects,
  devices,
  onBusyChange,
  onDirtyChange,
  onSaved,
}: {
  workspaceId: string;
  dataset: Dataset | null;
  prefill?: DatasetPrefill;
  projects: JsonRecord[];
  devices: JsonRecord[];
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (
    action: () => Promise<Dataset>,
    message: string,
  ) => Promise<boolean>;
}) {
  const initialDataType = dataset?.data_type ?? "telemetry";
  const initialStartTime =
    dataset
      ? localTime(dataset.time_start)
      : prefill?.startTime ?? localTime(new Date(Date.now() - 7 * 86_400_000));
  const initialEndTime =
    dataset
      ? localTime(dataset.time_end)
      : prefill?.endTime ?? localTime(new Date());
  const generatedName = `${datasetTypeLabel(initialDataType)} ${initialStartTime.slice(0, 10)}`;
  const [name, setName] = useState(
    dataset?.name ?? prefill?.name ?? generatedName,
  );
  const [description, setDescription] = useState(dataset?.description ?? "");
  const [projectId, setProjectId] = useState(dataset?.project_id ?? "");
  const [dataType, setDataType] = useState<Dataset["data_type"]>(initialDataType);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [status, setStatus] = useState<Dataset["status"]>(
    dataset?.status ?? "draft",
  );
  const [sources, setSources] = useState<SourceInput[]>(
    () =>
      dataset?.sources.map((item) => ({
        source_type: item.source_type,
        source_id: item.source_id,
      })) ?? prefill?.sources ?? [],
  );
  const initialSourceType: AddableSourceType =
    dataset?.sources.some((item) => item.source_type === "device")
      ? "device"
      : "data_stream";
  const [sourceType, setSourceType] =
    useState<AddableSourceType>(initialSourceType);
  const [streamKind, setStreamKind] = useState<"telemetry" | "image">(
    dataset?.data_type === "image" ? "image" : "telemetry",
  );
  const [deviceId, setDeviceId] = useState("");
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const datasetDevices = useMemo(
    () => devices.filter((item) => Boolean(datasetDeviceSystem(item))),
    [devices],
  );
  const gatewayDevices = useMemo(
    () => devices.filter((item) => String(item.device_type ?? "") === "gateway"),
    [devices],
  );
  const childQueries = useQueries({
    queries: gatewayDevices.map((gateway) => ({
      queryKey: ["device", String(gateway.id), "children", "dataset-form"],
      queryFn: () => api.devices.children(String(gateway.id)),
      staleTime: 60_000,
    })),
  });
  const datasetSelectableDevices = useMemo(() => {
    const items = [...datasetDevices];
    for (const result of childQueries) {
      for (const item of result.data?.items ?? []) {
        const child = item.device as unknown as JsonRecord;
        if (!items.some((candidate) => String(candidate.id) === String(child.id))) items.push(child);
      }
    }
    return items;
  }, [childQueries, datasetDevices]);
  const initialFingerprint = useRef<string | undefined>(undefined);
  const fingerprint = JSON.stringify({
    name,
    description,
    projectId,
    dataType,
    startTime,
    endTime,
    status,
    sources,
  });
  if (initialFingerprint.current === undefined) initialFingerprint.current = fingerprint;
  const dirty = initialFingerprint.current !== fingerprint;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const streams = useQuery({
    queryKey: ["device", deviceId, "streams", "dataset-form"],
    queryFn: () => api.dataStreams.list(deviceId),
    enabled: sourceType === "data_stream" && Boolean(deviceId),
  });
  useEffect(() => {
    setSelectedStreamIds([]);
  }, [deviceId, sourceType, streamKind]);
  const addSources = () => {
    const ids = sourceType === "device" ? [deviceId] : selectedStreamIds;
    const currentSystems = new Set(
      sources.flatMap((source) => {
        if (source.source_type === "device") {
          const item = devices.find((candidate) => String(candidate.id) === source.source_id);
          return datasetDeviceSystem(item) ? [datasetDeviceSystem(item)] : [];
        }
        return [];
      }),
    );
    const selectedSystem = datasetDeviceSystem(
      devices.find((item) => String(item.id) === deviceId),
    );
    if (selectedSystem && currentSystems.size > 0 && !currentSystems.has(selectedSystem)) {
      setError("一个数据集只能选择标准站或组网站中的一种设备体系");
      return;
    }
    const additions = ids
      .filter(Boolean)
      .filter(
        (id) =>
          !sources.some(
            (item) => item.source_type === sourceType && item.source_id === id,
          ),
      )
      .map((source_id) => ({ source_type: sourceType, source_id }));
    if (!additions.length) return;
    setSources((current) => [...current, ...additions]);
    if (sourceType === "device") setDataType("mixed");
    if (sourceType === "data_stream") {
      setDataType((current) => current === "image" && streamKind === "telemetry" ? "mixed" : current === "telemetry" && streamKind === "image" ? "mixed" : streamKind);
    }
    setError("");
    if (sourceType === "data_stream") setSelectedStreamIds([]);
  };
  const toggleStream = (streamId: string) => {
    setSelectedStreamIds((current) =>
      current.includes(streamId)
        ? current.filter((id) => id !== streamId)
        : [...current, streamId],
    );
  };
  const availableStreams =
    streams.data?.items.filter((item) =>
      streamKind === "image" ? item.type === "image" : item.type === "telemetry",
    ) ?? [];
  const availableStreamIds = availableStreams.map((item) => item.id);
  const existingStreamIds = new Set(
    sources
      .filter((item) => item.source_type === "data_stream")
      .map((item) => item.source_id),
  );
  const selectableStreamIds = availableStreamIds.filter(
    (id) => !existingStreamIds.has(id),
  );
  const allStreamsSelected =
    selectableStreamIds.length > 0 &&
    selectableStreamIds.every((id) => selectedStreamIds.includes(id));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sources.length) {
      setError("请至少添加一个设备或数据流来源");
      return;
    }
    const startMs = Date.parse(startTime);
    const endMs = Date.parse(endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      setError("请选择有效的时间范围，且结束时间必须晚于开始时间");
      return;
    }
    onBusyChange(true);
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
      onBusyChange(false);
    }
  };
  return (
    <div className="section-gap dataset-editor-page">
      <form id="dataset-form" onSubmit={submit}>
        <section className="dataset-editor-section dataset-sources">
          <div className="dataset-editor-section-heading">
            <div>
              <h2>数据来源</h2>
              <p>先选择设备，再批量选择要加入数据集的数据指标。</p>
            </div>
            <span className="dataset-source-count">{sources.length} 个已选择</span>
          </div>
          <div className="dataset-source-mode" role="group" aria-label="来源类型">
            <button
              type="button"
              className={sourceType === "device" ? "active" : ""}
              onClick={() => setSourceType("device")}
            >
              整台设备
            </button>
            <button
              type="button"
              className={sourceType === "data_stream" ? "active" : ""}
              onClick={() => setSourceType("data_stream")}
            >
              数据指标
            </button>
          </div>
          <div className="source-picker">
            <label className="field">
              <span className="field-label">设备</span>
              <select
                aria-label="来源设备"
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
              >
                <option value="">选择设备</option>
                {datasetSelectableDevices.map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>
                    {String(item.name)} · {String(item.serial_no)}
                  </option>
                ))}
              </select>
            </label>
            {sourceType === "device" && (
              <Button
                type="button"
                variant="secondary"
                disabled={!deviceId}
                onClick={addSources}
              >
                <Plus size={13} />
                添加整台设备
              </Button>
            )}
          </div>
          {sourceType === "data_stream" && (
            <div className="dataset-stream-picker">
              <div className="dataset-stream-picker-header">
                <div>
                  <strong>
                    可选{streamKind === "image" ? "图片数据流" : "遥测指标"}
                  </strong>
                  <span>
                    {deviceId
                      ? `${selectedStreamIds.length} 项已选`
                      : "选择设备后加载指标"}
                  </span>
                </div>
                {deviceId && selectableStreamIds.length > 0 && (
                  <button
                    type="button"
                    className="dataset-stream-select-all"
                    onClick={() =>
                      setSelectedStreamIds(
                        allStreamsSelected ? [] : availableStreamIds,
                      )
                    }
                  >
                    {allStreamsSelected ? "清空选择" : "全选指标"}
                  </button>
                )}
              </div>
              <div className="dataset-stream-kind" role="group" aria-label="数据类型">
                <button
                  type="button"
                  className={streamKind === "telemetry" ? "active" : ""}
                  onClick={() => setStreamKind("telemetry")}
                >
                  遥测数据
                </button>
                <button
                  type="button"
                  className={streamKind === "image" ? "active" : ""}
                  onClick={() => setStreamKind("image")}
                >
                  图片
                </button>
              </div>
              {!deviceId ? (
                <div className="dataset-stream-empty">请先选择设备</div>
              ) : streams.isLoading ? (
                <div className="dataset-stream-empty">正在加载数据指标…</div>
              ) : availableStreams.length ? (
                <div className="dataset-stream-options">
                  {availableStreams.map((item) => (
                    <label
                      key={item.id}
                      className={`dataset-stream-option${selectedStreamIds.includes(item.id) ? " selected" : ""}${existingStreamIds.has(item.id) ? " added" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={
                          existingStreamIds.has(item.id) ||
                          selectedStreamIds.includes(item.id)
                        }
                        disabled={existingStreamIds.has(item.id)}
                        onChange={() => toggleStream(item.id)}
                      />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {existingStreamIds.has(item.id) ? "已添加" : item.code}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="dataset-stream-empty">
                  该设备暂无可用{streamKind === "image" ? "图片数据流" : "遥测指标"}
                </div>
              )}
              <div className="dataset-stream-picker-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!selectedStreamIds.length}
                  onClick={addSources}
                >
                  <Plus size={13} />
                  添加已选{streamKind === "image" ? "图片" : "指标"}
                </Button>
              </div>
            </div>
          )}
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
              description="可以添加整台设备，或先选择设备后批量添加多个数据指标。"
            />
          )}
        </section>
        <section className="dataset-editor-section">
          <div className="dataset-editor-section-heading">
            <div>
              <h2>基本信息</h2>
              <p>
                {prefill?.sources.length
                  ? `已带入 ${prefill.sources.length} 个数据指标和查询时间，可继续调整`
                  : dataset
                    ? "修改名称、时间范围、来源和状态"
                    : "定义数据集名称、类型和查询范围"}
              </p>
            </div>
            {dirty && <Badge tone="warning">未保存</Badge>}
          </div>
          <div className="dataset-form-grid">
            <label className="field">
              <div className="dataset-field-label-row">
                <span className="field-label">名称</span>
                <button
                  type="button"
                  className="dataset-auto-name"
                  onClick={() =>
                    setName(`${datasetTypeLabel(dataType)} ${startTime.slice(0, 10)}`)
                  }
                >
                  <RefreshCw size={11} />
                  自动生成
                </button>
              </div>
              <input
                required
                aria-label="名称"
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
              <div className="dataset-derived-type">
                <strong>{datasetTypeLabel(dataType)}</strong>
                <small>根据已选设备、指标和图片自动判断</small>
              </div>
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
        </section>
        {error && <div className="form-error dataset-error">{error}</div>}
      </form>
    </div>
  );
}

function DatasetSourceSummary({
  sources,
  devices,
  limit = 2,
}: {
  sources: SourceInput[];
  devices: JsonRecord[];
  limit?: number;
}) {
  const visible = sources.slice(0, limit);
  return (
    <div className="dataset-source-summary">
      {visible.map((source) => (
        <div key={`${source.source_type}-${source.source_id}`}>
          <SourceName source={source} devices={devices} />
          <small>{sourceTypeLabel(source.source_type)}</small>
        </div>
      ))}
      {sources.length > visible.length && (
        <span className="dataset-source-more">+ {sources.length - visible.length} 个</span>
      )}
    </div>
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
  const listedDevice = devices.find(
    (item) => String(item.id) === stream.data?.device_id,
  );
  const streamDevice = useQuery({
    queryKey: ["device", stream.data?.device_id, "dataset-source-name"],
    queryFn: () => api.devices.get(stream.data!.device_id),
    enabled: Boolean(
      source.source_type === "data_stream" &&
        stream.data?.device_id &&
        !listedDevice,
    ),
    staleTime: 60_000,
  });
  if (source.source_type === "device") {
    const device = devices.find((item) => String(item.id) === source.source_id);
    return (
      <span className="dataset-source-identity">
        {String(device?.name ?? device?.serial_no ?? "未知设备")}
      </span>
    );
  }
  if (source.source_type === "file")
    return <span className="dataset-source-identity">文件来源</span>;
  if (stream.isLoading)
    return <span className="dataset-source-identity">正在加载数据来源…</span>;
  if (!stream.data)
    return <span className="dataset-source-identity">未命名数据指标</span>;
  const device = listedDevice ?? streamDevice.data;
  const deviceName = String(
    device?.name ?? device?.serial_no ?? "未知设备",
  );
  const serialNumber = device?.serial_no ? String(device.serial_no) : "";
  return (
    <span className="dataset-source-identity">
      <strong>
        {deviceName}
        {serialNumber ? ` · ${serialNumber}` : ""}
      </strong>
      <small>
        {stream.data.computed ? "fx · " : ""}
        {stream.data.name} · {stream.data.code}
      </small>
    </span>
  );
}

function DatasetPreview({
  dataset,
  devices,
  projectName,
}: {
  dataset: Dataset;
  devices: JsonRecord[];
  projectName?: unknown;
}) {
  const datasetStartMs = Date.parse(dataset.time_start);
  const datasetEndMs = Date.parse(dataset.time_end);
  const validDatasetRange = Number.isFinite(datasetStartMs) && Number.isFinite(datasetEndMs) && datasetStartMs < datasetEndMs;
  const queryStart = validDatasetRange
    ? new Date(datasetStartMs).toISOString()
    : "";
  const queryEnd = validDatasetRange
    ? new Date(datasetEndMs).toISOString()
    : "";
  const previewable = ["telemetry", "mixed"].includes(dataset.data_type);
  const query = useQuery({
    queryKey: ["dataset", dataset.id, "preview", queryStart, queryEnd],
    queryFn: () =>
      api.telemetry.dataset(dataset.id, {
        startTime: queryStart,
        endTime: queryEnd,
        limit: 500,
      }),
    enabled: previewable && validDatasetRange,
  });
  const series = ((query.data as any)?.series ?? []) as TelemetrySeries[];
  const points = series
    .flatMap((item) => item.points.map((point) => ({ ...point, series: item })))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return (
    <Panel className="section-gap dataset-page-panel dataset-preview">
      <div className="panel-header">
        <div>
          <div className="dataset-panel-heading">
            <h2 className="panel-title">数据预览</h2>
            <span className="dataset-panel-context">已保存范围</span>
          </div>
          <div className="panel-kicker">
            按数据集定义的时间范围展示趋势和明细；如需调整，请进入编辑
          </div>
        </div>
      </div>
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
            <small>所属项目</small>
            <strong>{String(projectName ?? "未关联项目")}</strong>
          </span>
          <span>
            <small>数据范围</small>
            <strong className="dataset-preview-time-range">
              {displayTime(dataset.time_start)} 至 {displayTime(dataset.time_end)}
            </strong>
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
        <details className="dataset-source-details" open>
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
                <SourceName source={source} devices={devices} />
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
      ) : !validDatasetRange ? (
        <StateView
          type="error"
          title="时间范围无效"
          description="数据集保存的开始时间必须早于结束时间，请进入编辑修正。"
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
