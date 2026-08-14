import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartNoAxesCombined, Clock3, CopyPlus, Database, PanelsTopLeft, Percent, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import {
  api,
  formatApiError,
  type DataStream,
  type Device,
  type TelemetrySeries,
} from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";
import { DeviceCombobox } from "./device-combobox";
import {
  datasetCreatePath,
  encodeComparisonSeeds,
  parseComparisonSeeds,
} from "./data-workflow";

const colors = ["#1769e0", "#16845b", "#d36b12", "#b13e4a", "#6a5ab5", "#00859b", "#9a6b18", "#6b7280"];
const MAX_COMPARISONS = 8;

export type ComparisonDraft = {
  id: string;
  deviceId: string;
  streamId: string;
  startTime: string;
  endTime: string;
};

export type ComparisonGroup = {
  key: string;
  deviceId: string;
  startTime: string;
  endTime: string;
  streamIds: string[];
  itemIds: string[];
};

export function groupComparisonDrafts(items: ComparisonDraft[]): ComparisonGroup[] {
  const groups = new Map<string, ComparisonGroup>();
  for (const item of items) {
    const key = `${item.deviceId}\u0000${item.startTime}\u0000${item.endTime}`;
    const group = groups.get(key) ?? {
      key,
      deviceId: item.deviceId,
      startTime: item.startTime,
      endTime: item.endTime,
      streamIds: [],
      itemIds: [],
    };
    if (!group.streamIds.includes(item.streamId)) group.streamIds.push(item.streamId);
    group.itemIds.push(item.id);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    streamIds: [...group.streamIds].sort(),
  }));
}

export type ComparisonStatistic = {
  count: number;
  min: number;
  max: number;
  average: number;
  latest: number;
};

const dateTimeLocal = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const createDraft = (deviceId = ""): ComparisonDraft => ({
  id: crypto.randomUUID(),
  deviceId,
  streamId: "",
  startTime: dateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)),
  endTime: dateTimeLocal(new Date()),
});

const validLocalTime = (value: string | null, fallback: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return fallback;
  return dateTimeLocal(new Date(value));
};

function createInitialDrafts(searchParams: URLSearchParams) {
  const seeds = parseComparisonSeeds(searchParams.get("items"));
  if (!seeds.length) return [createDraft()];
  const fallback = createDraft();
  const startTime = validLocalTime(searchParams.get("start"), fallback.startTime);
  const endTime = validLocalTime(searchParams.get("end"), fallback.endTime);
  return seeds.map((seed) => ({
    id: crypto.randomUUID(),
    deviceId: seed.deviceId,
    streamId: seed.streamId,
    startTime: validLocalTime(seed.startTime ?? null, startTime),
    endTime: validLocalTime(seed.endTime ?? null, endTime),
  }));
}

const formatNumber = (value: number) =>
  new Intl.NumberFormat(document.documentElement.lang || "zh-CN", { maximumFractionDigits: 3 }).format(value);

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatExactTime = (value: number | string) =>
  new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

export function comparisonStatistic(series?: TelemetrySeries): ComparisonStatistic | null {
  if (!series) return null;
  const points = series.points.filter((point) => Number.isFinite(point.value));
  if (!points.length) return null;
  const values = points.map((point) => point.value);
  return {
    count: series.source_count || points.length,
    min: Math.min(...values),
    max: Math.max(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    latest: points.at(-1)!.value,
  };
}

export function DataComparisonPage() {
  const { currentId } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialDrafts] = useState(() => createInitialDrafts(searchParams));
  const seeded = initialDrafts.some((item) => item.streamId);
  const previousWorkspaceId = useRef(currentId);
  const devicesQuery = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices", "comparison"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const devices = devicesQuery.data?.items ?? [];
  const [drafts, setDrafts] = useState<ComparisonDraft[]>(initialDrafts);
  const [applied, setApplied] = useState<ComparisonDraft[]>(
    seeded ? initialDrafts : [],
  );
  const [validationError, setValidationError] = useState("");
  const [editingConditions, setEditingConditions] = useState(!seeded);
  const [searchVersion, setSearchVersion] = useState(0);
  const [chartMode, setChartMode] = useState<"raw" | "minmax" | "zscore">("raw");
  const [timeAlignment, setTimeAlignment] = useState<"time" | "progress">("time");
  const dirty = applied.length > 0 && JSON.stringify(drafts) !== JSON.stringify(applied);

  useEffect(() => {
    if (!devices.length || drafts.some((item) => item.deviceId)) return;
    setDrafts((current) => current.map((item, index) => index ? item : { ...item, deviceId: devices[0].id }));
  }, [devices, drafts]);

  useEffect(() => {
    if (previousWorkspaceId.current === currentId) return;
    previousWorkspaceId.current = currentId;
    setApplied([]);
    setValidationError("");
    setEditingConditions(true);
  }, [currentId]);

  const updateDraft = (id: string, patch: Partial<ComparisonDraft>) =>
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  const search = () => {
    const invalid = drafts.find((item) =>
      !item.deviceId || !item.streamId || !item.startTime || !item.endTime ||
      Date.parse(item.startTime) >= Date.parse(item.endTime),
    );
    if (invalid) {
      setValidationError("请为每个对比项选择设备、数据要素和有效时间范围。");
      return;
    }
    setValidationError("");
    const next = drafts.map((item) => ({ ...item }));
    setApplied(next);
    setSearchParams({
      items: encodeComparisonSeeds(
        next.map(({ deviceId, streamId, startTime, endTime }) => ({
          deviceId,
          streamId,
          startTime,
          endTime,
        })),
      ),
    }, { replace: true });
    setSearchVersion((current) => current + 1);
    setEditingConditions(false);
  };

  const addComparison = () => setDrafts((current) => {
    const source = current[0];
    const next = createDraft(source?.deviceId);
    return [
      ...current,
      {
        ...next,
        startTime: source?.startTime ?? next.startTime,
        endTime: source?.endTime ?? next.endTime,
      },
    ];
  });

  const cancelEditing = () => {
    setDrafts(applied.map((item) => ({ ...item })));
    setValidationError("");
    setEditingConditions(false);
  };

  const appliedGroups = useMemo(() => groupComparisonDrafts(applied), [applied]);
  const results = useQueries({
    queries: appliedGroups.map((group) => {
      const streamCount = Math.max(1, group.streamIds.length);
      return {
        queryKey: workspaceQueryKey(
          currentId,
          "data-comparison",
          group.deviceId,
          group.streamIds.join(","),
          group.startTime,
          group.endTime,
          String(searchVersion),
        ),
        queryFn: () => api.telemetry.device(group.deviceId, {
          startTime: new Date(group.startTime).toISOString(),
          endTime: new Date(group.endTime).toISOString(),
          limit: Math.min(5000, Math.max(500, Math.floor(20_000 / streamCount))),
          adaptive: true,
          targetPoints: Math.min(1000, Math.max(200, Math.floor(6_000 / streamCount))),
          dataStreamIds: group.streamIds,
        }),
        enabled: Boolean(currentId),
        staleTime: 60_000,
      };
    }),
  });

  const compared = applied.map((item) => {
    const groupIndex = appliedGroups.findIndex((group) => group.itemIds.includes(item.id));
    const query = results[groupIndex];
    return {
      config: item,
      device: devices.find((device) => device.id === item.deviceId),
      query,
      series: query?.data?.series.find((series) => series.data_stream_id === item.streamId),
    };
  });
  const successful = compared.filter((item) => item.series?.points.length);
  const loading = results.some((result) => result.isLoading || result.isFetching);
  const appliedDeviceCount = new Set(applied.map((item) => item.deviceId)).size;
  const appliedRangeCount = new Set(applied.map((item) => `${item.startTime}\u0000${item.endTime}`)).size;
  const datasetStart = applied.length
    ? applied.reduce((value, item) =>
        Date.parse(item.startTime) < Date.parse(value) ? item.startTime : value,
      applied[0].startTime)
    : "";
  const datasetEnd = applied.length
    ? applied.reduce((value, item) =>
        Date.parse(item.endTime) > Date.parse(value) ? item.endTime : value,
      applied[0].endTime)
    : "";

  if (!currentId) return <Panel><StateView type="empty" title="请选择工作区" description="选择工作区后可以读取设备数据。" /></Panel>;

  return (
    <>
      <PageHeader title="数据对比" />
      <Panel className={`comparison-conditions section-gap ${editingConditions ? "is-editing" : "is-collapsed"}`}>
        {editingConditions ? (
          <>
            <div className="panel-header comparison-panel-header">
              <div>
                <h2 className="panel-title">设置对比条件</h2>
                <div className="panel-kicker">每项可以选择不同设备、数据要素和时间范围，最多 {MAX_COMPARISONS} 项</div>
              </div>
              <div className="header-actions">
                {dirty && <Badge tone="warning">条件未应用</Badge>}
                {applied.length > 0 && (
                  <Button variant="secondary" onClick={cancelEditing}><X size={14} />取消</Button>
                )}
                <Button disabled={loading || devicesQuery.isLoading} onClick={search}>
                  <Search size={14} />{loading ? "查询中…" : "应用并查询"}
                </Button>
              </div>
            </div>
            {devicesQuery.isLoading ? (
              <StateView type="loading" title="正在加载设备" description="正在读取当前工作区的设备。" />
            ) : devicesQuery.error ? (
              <StateView type="error" title="设备加载失败" description={formatApiError(devicesQuery.error).message} requestId={formatApiError(devicesQuery.error).requestId} />
            ) : (
              <div className="comparison-condition-list">
                <div className="comparison-condition-columns" aria-hidden="true">
                  <span>序号</span><span>设备</span><span>数据要素</span><span>开始时间</span><span>结束时间</span><span>操作</span>
                </div>
                {drafts.map((draft, index) => (
                  <ComparisonCondition
                    key={draft.id}
                    workspaceId={currentId}
                    index={index}
                    value={draft}
                    devices={devices}
                    onChange={(patch) => updateDraft(draft.id, patch)}
                    onDuplicate={() => drafts.length < MAX_COMPARISONS && setDrafts((current) => [...current, { ...draft, id: crypto.randomUUID() }])}
                    onRemove={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}
                    removable={drafts.length > 1}
                  />
                ))}
                <button type="button" className="comparison-add-row" disabled={drafts.length >= MAX_COMPARISONS} onClick={addComparison}>
                  <Plus size={14} />{drafts.length >= MAX_COMPARISONS ? `已达到 ${MAX_COMPARISONS} 项上限` : "添加对比项"}
                </button>
              </div>
            )}
            {validationError && <div className="form-error comparison-error">{validationError}</div>}
          </>
        ) : (
          <div className="comparison-condition-summary">
            <div className="comparison-summary-title">
              <span className="comparison-summary-icon"><ChartNoAxesCombined size={17} /></span>
              <div>
                <h2 className="panel-title">对比条件已应用</h2>
                <div className="panel-kicker">
                  {applied.length} 项 · {appliedDeviceCount} 台设备 · {appliedRangeCount === 1 ? `${formatTime(applied[0].startTime)} — ${formatTime(applied[0].endTime)}` : `${appliedRangeCount} 个时间范围`}
                </div>
              </div>
            </div>
            <div className="comparison-summary-actions">
              {loading && <Badge tone="info">正在更新数据</Badge>}
              <Button variant="secondary" onClick={() => setEditingConditions(true)}><SlidersHorizontal size={14} />编辑条件</Button>
            </div>
          </div>
        )}
      </Panel>

      {applied.length ? (
        <>
          <Panel className="section-gap comparison-result-panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">
                  {chartMode === "raw"
                    ? "原始值对比"
                    : chartMode === "minmax"
                      ? "Min-Max 趋势对比"
                      : "Z-score 偏离对比"}
                </h2>
                <div className="panel-kicker">
                  {chartMode === "raw"
                    ? "不同单位使用独立 Y 轴，相同单位共用量程"
                    : chartMode === "minmax"
                      ? "各序列按当前查询范围缩放到 0–1，用于比较曲线形态"
                      : "各序列转换为距自身均值的标准差倍数，用于比较异常程度"}
                </div>
              </div>
              <div className="header-actions">
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate(
                      datasetCreatePath({
                        sourceIds: [...new Set(applied.map((item) => item.streamId))],
                        startTime: datasetStart,
                        endTime: datasetEnd,
                        name: `数据对比 ${dateTimeLocal(new Date()).slice(0, 10)}`,
                      }),
                    )
                  }
                >
                  <Database size={14} />
                  保存为数据集
                </Button>
                <div className="chart-mode" aria-label="对比图表模式">
                  <button type="button" className={chartMode === "raw" ? "active" : ""} onClick={() => setChartMode("raw")}><PanelsTopLeft size={13} />原始值</button>
                  <button type="button" className={chartMode === "minmax" ? "active" : ""} onClick={() => setChartMode("minmax")}><ChartNoAxesCombined size={13} />Min-Max</button>
                  <button type="button" className={chartMode === "zscore" ? "active" : ""} onClick={() => setChartMode("zscore")}><ChartNoAxesCombined size={13} />Z-score</button>
                </div>
                <div className="chart-mode" aria-label="时间轴对齐方式">
                  <button type="button" className={timeAlignment === "time" ? "active" : ""} onClick={() => setTimeAlignment("time")}><Clock3 size={13} />实际时间</button>
                  <button type="button" className={timeAlignment === "progress" ? "active" : ""} onClick={() => setTimeAlignment("progress")}><Percent size={13} />进度对齐</button>
                </div>
                <Badge tone="info">{successful.length} / {applied.length} 项</Badge>
              </div>
            </div>
            {loading && !successful.length ? (
              <StateView type="loading" title="正在加载对比数据" description="各对比项正在并行查询。" />
            ) : successful.length ? (
              chartMode === "raw"
                ? <MultiAxisComparisonChart alignment={timeAlignment} items={successful.map((item) => ({ config: item.config, device: item.device, series: item.series! }))} />
                : <RelativeComparisonChart alignment={timeAlignment} method={chartMode} items={successful.map((item) => ({ config: item.config, device: item.device, series: item.series! }))} />
            ) : (
              <StateView type="empty" title="当前条件没有可对比的数据" description="可以调整设备、数据要素或时间范围后重新搜索。" />
            )}
          </Panel>
          <Panel className="section-gap">
            <div className="panel-header"><h2 className="panel-title">统计对比</h2></div>
            <ComparisonStatistics items={compared} />
          </Panel>
        </>
      ) : (
        <Panel className="section-gap"><StateView type="empty" title="设置条件后开始对比" description="至少选择一个设备、数据要素和时间范围。" /></Panel>
      )}
    </>
  );
}

function ComparisonCondition({
  value,
  workspaceId,
  devices,
  index,
  onChange,
  onDuplicate,
  onRemove,
  removable,
}: {
  value: ComparisonDraft;
  workspaceId: string;
  devices: Device[];
  index: number;
  onChange: (patch: Partial<ComparisonDraft>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const streams = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "comparison-streams", value.deviceId),
    queryFn: () => api.dataStreams.list(value.deviceId),
    enabled: Boolean(value.deviceId),
  });
  const metrics = useMemo(
    () => (streams.data?.items ?? []).filter((item) => item.type === "telemetry" && item.status === "active"),
    [streams.data?.items],
  );

  useEffect(() => {
    if (!streams.isSuccess) return;
    const nextStreamId = metrics.some((item) => item.id === value.streamId)
      ? value.streamId
      : metrics[0]?.id ?? "";
    if (nextStreamId !== value.streamId) onChange({ streamId: nextStreamId });
  }, [metrics, streams.isSuccess, value.streamId]);

  return (
    <div className="comparison-condition-row">
      <div className="comparison-index">{index + 1}</div>
      <div className="comparison-field comparison-device-field">
        <span className="field-label comparison-mobile-label">设备</span>
        <DeviceCombobox devices={devices} value={value.deviceId} className="comparison-device-control" ariaLabel="搜索对比设备" onChange={(deviceId) => onChange({ deviceId, streamId: "" })} />
      </div>
      <label className="comparison-field">
        <span className="field-label comparison-mobile-label">数据要素</span>
        <select value={value.streamId} disabled={streams.isLoading || !metrics.length} onChange={(event) => onChange({ streamId: event.target.value })}>
          <option value="">{streams.isLoading ? "加载中…" : metrics.length ? "选择要素" : "无可用要素"}</option>
          {metrics.map((item) => (
            <option key={item.id} value={item.id}>
              {item.computed ? "fx · " : ""}{item.name}{item.unit ? `（${item.unit}）` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="comparison-field">
        <span className="field-label comparison-mobile-label">开始时间</span>
        <input type="datetime-local" value={value.startTime} onChange={(event) => onChange({ startTime: event.target.value })} />
      </label>
      <label className="comparison-field">
        <span className="field-label comparison-mobile-label">结束时间</span>
        <input type="datetime-local" value={value.endTime} onChange={(event) => onChange({ endTime: event.target.value })} />
      </label>
      <div className="comparison-row-actions">
        <button type="button" title="复制对比项" aria-label="复制对比项" onClick={onDuplicate}><CopyPlus size={15} /></button>
        <button type="button" title="删除对比项" aria-label="删除对比项" disabled={!removable} onClick={onRemove}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

function MultiAxisComparisonChart({ items, alignment }: { items: { config: ComparisonDraft; device?: Device; series: TelemetrySeries }[]; alignment: "time" | "progress" }) {
  const { data, units } = useMemo(() => {
    const byUnit = new Map<string, typeof items>();
    const rows = new Map<number, Record<string, number>>();
    items.forEach((item) => {
      const unit = item.series.unit?.trim() || "无单位";
      byUnit.set(unit, [...(byUnit.get(unit) ?? []), item]);
      const start = Date.parse(item.config.startTime);
      const end = Date.parse(item.config.endTime);
      item.series.points.forEach((point) => {
        const timestamp = Date.parse(point.ts);
        if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) return;
        const progress = Math.max(0, Math.min(100, ((timestamp - start) / (end - start)) * 100));
        const x = alignment === "progress" ? Math.round(progress * 5) / 5 : timestamp;
        const row = rows.get(x) ?? { x };
        row[item.config.id] = point.value;
        row[`${item.config.id}:time`] = timestamp;
        rows.set(x, row);
      });
    });
    return {
      data: [...rows.values()].sort((a, b) => a.x - b.x),
      units: [...byUnit.entries()].map(([unit, entries]) => ({ unit, entries })),
    };
  }, [alignment, items]);

  return <div className="relative-comparison">
    <ComparisonLegend items={items} />
    <div className="multi-axis-comparison-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 10, bottom: 8, left: 10 }}>
          <CartesianGrid stroke="#e5edf3" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={alignment === "progress" ? [0, 100] : ["dataMin", "dataMax"]}
            tickFormatter={(value) => alignment === "progress" ? `${value}%` : formatTime(new Date(Number(value)).toISOString())}
            minTickGap={48}
            tick={{ fontSize: 10 }}
          />
          {units.map((group, index) => {
            const firstItem = group.entries[0];
            const color = colors[items.indexOf(firstItem) % colors.length];
            return <YAxis
              key={group.unit}
              yAxisId={group.unit}
              orientation={index % 2 ? "right" : "left"}
              tick={{ fontSize: 9, fill: color }}
              tickLine={false}
              axisLine={{ stroke: color }}
              width={52}
              tickFormatter={(value) => formatNumber(Number(value))}
              label={{ value: group.unit, angle: -90, position: index % 2 ? "insideRight" : "insideLeft", fill: color, fontSize: 9 }}
            />;
          })}
          <Tooltip content={<ComparisonTooltip items={items} mode="raw" />} />
          {items.map((item, index) => {
            const unit = item.series.unit?.trim() || "无单位";
            return <Line key={item.config.id} yAxisId={unit} type="monotone" dataKey={item.config.id} name={item.config.id} stroke={colors[index % colors.length]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />;
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="comparison-axis-note">
      {alignment === "progress"
        ? "横轴按各自时间范围映射为 0–100%；纵轴保留原始值，不同单位使用独立 Y 轴。"
        : "横轴使用真实采样时间；纵轴保留原始值，不同单位使用独立 Y 轴。"}
    </div>
  </div>;
}

function RelativeComparisonChart({ items, method, alignment }: { items: { config: ComparisonDraft; device?: Device; series: TelemetrySeries }[]; method: "minmax" | "zscore"; alignment: "time" | "progress" }) {
  const data = useMemo(() => {
    const rows = new Map<number, Record<string, number>>();
    items.forEach((item) => {
      const values = item.series.points.map((point) => point.value).filter(Number.isFinite);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min;
      const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const deviation = Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          Math.max(1, values.length),
      );
      const start = Date.parse(item.config.startTime);
      const end = Date.parse(item.config.endTime);
      item.series.points.forEach((point) => {
        const timestamp = Date.parse(point.ts);
        if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) return;
        const progress = Math.max(0, Math.min(100, ((timestamp - start) / (end - start)) * 100));
        const x = alignment === "progress" ? Math.round(progress * 5) / 5 : timestamp;
        const row = rows.get(x) ?? { x };
        row[item.config.id] =
          method === "minmax"
            ? span
              ? (point.value - min) / span
              : 0.5
            : deviation
              ? (point.value - mean) / deviation
              : 0;
        row[`${item.config.id}:raw`] = point.value;
        row[`${item.config.id}:time`] = timestamp;
        rows.set(x, row);
      });
    });
    return [...rows.values()].sort((a, b) => a.x - b.x);
  }, [alignment, items, method]);

  return <div className="relative-comparison">
    <ComparisonLegend items={items} />
    <div className="relative-comparison-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#e5edf3" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={alignment === "progress" ? [0, 100] : ["dataMin", "dataMax"]}
            tickFormatter={(value) => alignment === "progress" ? `${value}%` : formatTime(new Date(Number(value)).toISOString())}
            minTickGap={48}
            tick={{ fontSize: 10 }}
          />
          <YAxis domain={method === "minmax" ? [0, 1] : ["auto", "auto"]} tickFormatter={(value) => formatNumber(Number(value))} tick={{ fontSize: 10 }} width={48} />
          <Tooltip content={<ComparisonTooltip items={items} mode={method} />} />
          {items.map((item, index) => <Line key={item.config.id} type="monotone" dataKey={item.config.id} name={item.config.id} stroke={colors[index % colors.length]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="comparison-axis-note">
      {method === "minmax"
        ? "Min-Max = (原始值 − 最小值) / (最大值 − 最小值)，参数按当前查询范围计算。"
        : "Z-score = (原始值 − 均值) / 标准差，0 表示序列均值，正负值表示偏离方向。"}
      {alignment === "progress" ? " 横轴按观测进度对齐。" : " 横轴保留真实采样时间。"}
    </div>
  </div>;
}

function ComparisonTooltip({
  active,
  payload,
  items,
  mode,
}: {
  active?: boolean;
  payload?: Array<{
    color?: string;
    dataKey?: string | number;
    value?: number;
    payload?: Record<string, number>;
  }>;
  items: { config: ComparisonDraft; device?: Device; series: TelemetrySeries }[];
  mode: "raw" | "minmax" | "zscore";
}) {
  if (!active || !payload?.length) return null;
  const entries = payload
    .map((entry) => {
      const id = String(entry.dataKey ?? "");
      const item = items.find((candidate) => candidate.config.id === id);
      const time = entry.payload?.[`${id}:time`];
      if (!item || !Number.isFinite(time)) return null;
      return {
        entry,
        item,
        time: Number(time),
        raw:
          mode === "raw"
            ? Number(entry.value)
            : Number(entry.payload?.[`${id}:raw`]),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  if (!entries.length) return null;
  return (
    <div className="comparison-tooltip">
      <strong>采样时间</strong>
      {entries.map(({ entry, item, time, raw }) => (
        <div key={item.config.id}>
          <i style={{ background: entry.color }} />
          <span>
            <b>{item.device?.name ?? "设备"} · {item.series.name}</b>
            <small>{formatExactTime(time)}</small>
          </span>
          <em>
            {formatNumber(raw)}{item.series.unit ? ` ${item.series.unit}` : ""}
            {mode !== "raw" && (
              <small>
                {mode === "minmax" ? "Min-Max" : "Z-score"} {formatNumber(Number(entry.value))}
              </small>
            )}
          </em>
        </div>
      ))}
    </div>
  );
}

function ComparisonLegend({ items }: { items: { config: ComparisonDraft; device?: Device; series: TelemetrySeries }[] }) {
  return <div className="comparison-legend">{items.map((item, index) => <div key={item.config.id}><i style={{ background: colors[index % colors.length] }} /><span><strong>{item.device?.name ?? "设备"}</strong> · {item.series.name}</span><small>{formatTime(item.config.startTime)} 至 {formatTime(item.config.endTime)}</small></div>)}</div>;
}

function ComparisonStatistics({ items }: { items: { config: ComparisonDraft; device?: Device; query: { isLoading: boolean; error: unknown }; series?: TelemetrySeries }[] }) {
  return <div className="table-wrap"><table className="data-table comparison-table"><thead><tr><th>对比项</th><th>时间范围</th><th>数据量</th><th>最新值</th><th>平均值</th><th>最小 / 最大</th></tr></thead><tbody>{items.map((item, index) => {
    const stats = comparisonStatistic(item.series);
    const unit = item.series?.unit ? ` ${item.series.unit}` : "";
    return <tr key={item.config.id}><td><div className="comparison-table-title"><i style={{ background: colors[index % colors.length] }} /><div><strong>{item.device?.name ?? item.config.deviceId}</strong><small>{item.series?.name ?? "数据要素"}</small></div></div></td><td>{formatTime(item.config.startTime)}<small>至 {formatTime(item.config.endTime)}</small></td>{item.query.isLoading ? <td colSpan={4}>正在加载…</td> : item.query.error ? <td colSpan={4} className="comparison-query-error">{formatApiError(item.query.error).message}</td> : stats ? <><td>{stats.count.toLocaleString(document.documentElement.lang || "zh-CN")}</td><td>{formatNumber(stats.latest)}{unit}</td><td>{formatNumber(stats.average)}{unit}</td><td>{formatNumber(stats.min)} / {formatNumber(stats.max)}{unit}</td></> : <td colSpan={4}>暂无数据</td>}</tr>;
  })}</tbody></table></div>;
}
