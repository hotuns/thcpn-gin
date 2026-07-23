import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CopyPlus, Plus, Search, Trash2 } from "lucide-react";
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
  quality: number;
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

const formatNumber = (value: number) =>
  new Intl.NumberFormat(document.documentElement.lang || "zh-CN", { maximumFractionDigits: 3 }).format(value);

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function comparisonStatistic(series?: TelemetrySeries): ComparisonStatistic | null {
  if (!series) return null;
  const points = series.points.filter((point) => Number.isFinite(point.value));
  if (!points.length) return null;
  const values = points.map((point) => point.value);
  const healthy = points.filter((point) =>
    ["good", "valid", "ok"].includes((point.quality ?? "").toLowerCase()),
  ).length;
  return {
    count: series.source_count || points.length,
    min: Math.min(...values),
    max: Math.max(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    latest: points.at(-1)!.value,
    quality: Math.round((healthy / points.length) * 100),
  };
}

export function DataComparisonPage() {
  const { currentId } = useWorkspace();
  const devicesQuery = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices", "comparison"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const devices = devicesQuery.data?.items ?? [];
  const [drafts, setDrafts] = useState<ComparisonDraft[]>(() => [createDraft()]);
  const [applied, setApplied] = useState<ComparisonDraft[]>([]);
  const [validationError, setValidationError] = useState("");
  const [searchVersion, setSearchVersion] = useState(0);
  const dirty = applied.length > 0 && JSON.stringify(drafts) !== JSON.stringify(applied);

  useEffect(() => {
    if (!devices.length || drafts.some((item) => item.deviceId)) return;
    setDrafts((current) => current.map((item, index) => index ? item : { ...item, deviceId: devices[0].id }));
  }, [devices, drafts]);

  useEffect(() => {
    setApplied([]);
    setValidationError("");
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
    setApplied(drafts.map((item) => ({ ...item })));
    setSearchVersion((current) => current + 1);
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

  if (!currentId) return <Panel><StateView type="empty" title="请选择工作区" description="选择工作区后可以读取设备数据。" /></Panel>;

  return (
    <>
      <PageHeader title="数据对比" />
      <Panel className="comparison-conditions section-gap">
        <div className="panel-header comparison-panel-header">
          <h2 className="panel-title">对比条件</h2>
          <div className="header-actions">
            {dirty && <Badge tone="warning">条件未应用</Badge>}
            <Button
              variant="secondary"
              disabled={drafts.length >= MAX_COMPARISONS}
              onClick={() => setDrafts((current) => [...current, createDraft(current[0]?.deviceId)])}
            >
              <Plus size={14} />添加对比项
            </Button>
            <Button disabled={loading || devicesQuery.isLoading} onClick={search}>
              <Search size={14} />{loading ? "查询中…" : "搜索"}
            </Button>
          </div>
        </div>
        {devicesQuery.isLoading ? (
          <StateView type="loading" title="正在加载设备" description="正在读取当前工作区的设备。" />
        ) : devicesQuery.error ? (
          <StateView type="error" title="设备加载失败" description={formatApiError(devicesQuery.error).message} requestId={formatApiError(devicesQuery.error).requestId} />
        ) : (
          <div className="comparison-condition-list">
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
          </div>
        )}
        {validationError && <div className="form-error comparison-error">{validationError}</div>}
      </Panel>

      {applied.length ? (
        <>
          <Panel className="section-gap comparison-result-panel">
            <div className="panel-header"><h2 className="panel-title">趋势对比</h2><Badge tone="info">{successful.length} / {applied.length} 项</Badge></div>
            {loading && !successful.length ? (
              <StateView type="loading" title="正在加载对比数据" description="各对比项正在并行查询。" />
            ) : successful.length ? (
              <RelativeComparisonChart items={successful.map((item) => ({ config: item.config, device: item.device, series: item.series! }))} />
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
  const metrics = (streams.data?.items ?? []).filter((item) => item.type === "telemetry" && item.status === "active");

  useEffect(() => {
    if (!streams.isSuccess) return;
    if (!metrics.some((item) => item.id === value.streamId)) onChange({ streamId: metrics[0]?.id ?? "" });
  }, [metrics, onChange, streams.isSuccess, value.streamId]);

  const setQuickRange = (hours: number) => {
    const end = new Date();
    onChange({ startTime: dateTimeLocal(new Date(end.getTime() - hours * 60 * 60 * 1000)), endTime: dateTimeLocal(end) });
  };

  return (
    <div className="comparison-condition-row">
      <div className="comparison-index">{index + 1}</div>
      <div className="comparison-field comparison-device-field">
        <span className="field-label">设备</span>
        <DeviceCombobox devices={devices} value={value.deviceId} className="comparison-device-control" ariaLabel="搜索对比设备" onChange={(deviceId) => onChange({ deviceId, streamId: "" })} />
      </div>
      <label className="comparison-field">
        <span className="field-label">数据要素</span>
        <select value={value.streamId} disabled={streams.isLoading || !metrics.length} onChange={(event) => onChange({ streamId: event.target.value })}>
          <option value="">{streams.isLoading ? "加载中…" : metrics.length ? "选择要素" : "无可用要素"}</option>
          {metrics.map((item) => <option key={item.id} value={item.id}>{item.name}{item.unit ? `（${item.unit}）` : ""}</option>)}
        </select>
      </label>
      <label className="comparison-field">
        <span className="field-label">开始时间</span>
        <input type="datetime-local" value={value.startTime} onChange={(event) => onChange({ startTime: event.target.value })} />
      </label>
      <label className="comparison-field">
        <span className="field-label">结束时间</span>
        <input type="datetime-local" value={value.endTime} onChange={(event) => onChange({ endTime: event.target.value })} />
      </label>
      <div className="comparison-row-actions">
        <button type="button" onClick={() => setQuickRange(24)}>24 小时</button>
        <button type="button" onClick={() => setQuickRange(24 * 7)}>7 天</button>
        <button type="button" title="复制对比项" aria-label="复制对比项" onClick={onDuplicate}><CopyPlus size={15} /></button>
        <button type="button" title="删除对比项" aria-label="删除对比项" disabled={!removable} onClick={onRemove}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

function RelativeComparisonChart({ items }: { items: { config: ComparisonDraft; device?: Device; series: TelemetrySeries }[] }) {
  const data = useMemo(() => {
    const rows = new Map<number, Record<string, number>>();
    items.forEach((item) => {
      const values = item.series.points.map((point) => point.value).filter(Number.isFinite);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min;
      const start = Date.parse(item.config.startTime);
      const end = Date.parse(item.config.endTime);
      item.series.points.forEach((point) => {
        const timestamp = Date.parse(point.ts);
        if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) return;
        const progress = Math.max(0, Math.min(100, ((timestamp - start) / (end - start)) * 100));
        const bucket = Math.round(progress * 5) / 5;
        const row = rows.get(bucket) ?? { progress: bucket };
        row[item.config.id] = span ? ((point.value - min) / span) * 100 : 50;
        rows.set(bucket, row);
      });
    });
    return [...rows.values()].sort((a, b) => a.progress - b.progress);
  }, [items]);

  return <div className="relative-comparison">
    <div className="comparison-legend">{items.map((item, index) => <div key={item.config.id}><i style={{ background: colors[index % colors.length] }} /><span><strong>{item.device?.name ?? "设备"}</strong> · {item.series.name}</span><small>{formatTime(item.config.startTime)} 至 {formatTime(item.config.endTime)}</small></div>)}</div>
    <div className="relative-comparison-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#e5edf3" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="progress" type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} width={42} />
          <Tooltip labelFormatter={(value) => `时间进度 ${formatNumber(Number(value))}%`} formatter={(value, name) => [`${formatNumber(Number(value))}%`, String(name)]} />
          {items.map((item, index) => <Line key={item.config.id} type="monotone" dataKey={item.config.id} name={`${item.device?.name ?? "设备"} · ${item.series.name}`} stroke={colors[index % colors.length]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="comparison-axis-note">横轴按各自时间范围的进度对齐，纵轴按各序列最小值至最大值归一化。</div>
  </div>;
}

function ComparisonStatistics({ items }: { items: { config: ComparisonDraft; device?: Device; query: { isLoading: boolean; error: unknown }; series?: TelemetrySeries }[] }) {
  return <div className="table-wrap"><table className="data-table comparison-table"><thead><tr><th>对比项</th><th>时间范围</th><th>数据量</th><th>最新值</th><th>平均值</th><th>最小 / 最大</th><th>质量</th></tr></thead><tbody>{items.map((item, index) => {
    const stats = comparisonStatistic(item.series);
    const unit = item.series?.unit ? ` ${item.series.unit}` : "";
    return <tr key={item.config.id}><td><div className="comparison-table-title"><i style={{ background: colors[index % colors.length] }} /><div><strong>{item.device?.name ?? item.config.deviceId}</strong><small>{item.series?.name ?? "数据要素"}</small></div></div></td><td>{formatTime(item.config.startTime)}<small>至 {formatTime(item.config.endTime)}</small></td>{item.query.isLoading ? <td colSpan={5}>正在加载…</td> : item.query.error ? <td colSpan={5} className="comparison-query-error">{formatApiError(item.query.error).message}</td> : stats ? <><td>{stats.count.toLocaleString(document.documentElement.lang || "zh-CN")}</td><td>{formatNumber(stats.latest)}{unit}</td><td>{formatNumber(stats.average)}{unit}</td><td>{formatNumber(stats.min)} / {formatNumber(stats.max)}{unit}</td><td><Badge tone={stats.quality >= 90 ? "success" : stats.quality >= 60 ? "warning" : "danger"}>{stats.quality}%</Badge></td></> : <td colSpan={5}>暂无数据</td>}</tr>;
  })}</tbody></table></div>;
}
