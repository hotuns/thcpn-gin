import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Activity, Download, RefreshCw, Search } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  formatApiError,
  type CarbonFluxPoint,
  type CarbonPeriodDetail,
  type CarbonPeriodSummary,
  type Device,
} from "@thcpn/api";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";

const metricDefinitions = [
  { key: "nee", label: "NEE", color: "#0f766e" },
  { key: "er", label: "ER", color: "#2563eb" },
  { key: "gpp", label: "GPP", color: "#c2410c" },
] as const;

const formatDateTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";

const isOlderThanThreeDays = (value?: string) => {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp > 3 * 24 * 60 * 60 * 1000;
};

const formatNumber = (value?: number) =>
  value === undefined || value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });

const dateRange = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
};

const formatDateTimeLocal = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export function CarbonDevicePage({ device }: { device: Device }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedNode = Number(searchParams.get("node_id"));
  const nodeId = requestedNode > 0 ? requestedNode : 1;
  const [field, setField] = useState(searchParams.get("field") ?? "");
  const [selectedPeriod, setSelectedPeriod] = useState(searchParams.get("period") ?? "");
  const [initialRange] = useState(dateRange);
  const [startTime, setStartTime] = useState(() => formatDateTimeLocal(initialRange.start));
  const [endTime, setEndTime] = useState(() => formatDateTimeLocal(initialRange.end));
  const [range, setRange] = useState(initialRange);
  const [chartMode, setChartMode] = useState<"compare" | "separate">("separate");
  const periodDetailRef = useRef<HTMLDivElement>(null);
  const setNodeId = (nextNodeId: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("node_id", String(nextNodeId));
    next.delete("period");
    setSelectedPeriod("");
    setSearchParams(next, { replace: true });
  };
  const overview = useQuery({
    queryKey: ["carbon", device.id, "overview"],
    queryFn: () => api.carbon.overview(device.id),
  });
  const periods = useQuery({
    queryKey: ["carbon", device.id, "periods", nodeId, range.start, range.end],
    queryFn: () => api.carbon.periods(device.id, { nodeId, start: range.start, end: range.end }),
  });
  const fieldOptions = useMemo(() => {
    const values = new Set<string>(["A", "B", "C", "D"]);
    periods.data?.items.forEach((item) => item.flux_fields?.forEach((value) => values.add(value)));
    return [...values].sort();
  }, [periods.data]);
  useEffect(() => {
    if (!field && fieldOptions.length) setField(fieldOptions[0]);
    if (field && fieldOptions.length && !fieldOptions.includes(field)) setField(fieldOptions[0]);
  }, [field, fieldOptions]);
  useEffect(() => {
    setSelectedPeriod("");
  }, [nodeId, field]);
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("node_id", String(nodeId));
    if (field) next.set("field", field); else next.delete("field");
    if (selectedPeriod) next.set("period", selectedPeriod); else next.delete("period");
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [field, nodeId, searchParams, selectedPeriod, setSearchParams]);
  const flux = useQuery({
    queryKey: ["carbon", device.id, "flux", nodeId, field, range.start, range.end],
    queryFn: () => api.carbon.flux(device.id, { nodeId, field, start: range.start, end: range.end }),
    enabled: Boolean(field),
  });
  const selectedSummary = periods.data?.items.find((item) => item.period === selectedPeriod);
  const detail = useQuery({
    queryKey: ["carbon", device.id, "period", nodeId, field, selectedPeriod],
    queryFn: () => api.carbon.period(device.id, { nodeId, field, period: selectedPeriod }),
    enabled: Boolean(field && selectedPeriod),
  });
  const statusText = (status: string) =>
    ({ has_data: "有数据", no_data: "暂无数据" }[status] ?? status);
  const refresh = () => {
    void overview.refetch();
    void periods.refetch();
    void flux.refetch();
    if (selectedPeriod) void detail.refetch();
  };
  const invalidRange = !startTime || !endTime || Date.parse(startTime) >= Date.parse(endTime);
  const applyRange = () => {
    if (invalidRange) return;
    setSelectedPeriod("");
    setRange({ start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() });
  };
  const selectPeriodFromChart = (period: string) => {
    setSelectedPeriod(period);
    requestAnimationFrame(() => periodDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <div className="carbon-device-page">
      <Panel className="carbon-overview-panel">
        <div className="panel-header">
          <div><h2 className="panel-title">采集器概览</h2><div className="panel-kicker">一个采集器包含多个 node，node 不是独立设备</div></div>
          <div className="header-actions"><Button variant="secondary" onClick={refresh}><RefreshCw size={14} />刷新</Button><Activity size={17} /></div>
        </div>
        {overview.isLoading ? <StateView type="loading" title="正在读取最新数据" description="" /> : overview.error ? <StateView type="error" title="最新数据不可用" description={formatApiError(overview.error).message} /> : <>
          <div className="carbon-overview-stats">
            <div><span>数据概况</span><strong>{statusText(overview.data?.status ?? "no_data")}</strong></div>
            <div><span>节点数量</span><strong>{overview.data?.nodes_count ?? "—"}</strong></div>
            <div><span>最近采样</span><strong className="carbon-sample-time">{formatDateTime(overview.data?.latest_sample_at)}{isOlderThanThreeDays(overview.data?.latest_sample_at) ? <Badge tone="warning">三天前</Badge> : null}</strong></div>
            <div><span>最近通量</span><strong>{formatDateTime(overview.data?.latest_flux_at)}</strong></div>
          </div>
          {overview.data?.runtime && <div className="carbon-runtime-strip"><span>源库设备信息</span><strong>电池 {overview.data.runtime.battery || "—"}%</strong><strong>信号 {overview.data.runtime.signal || "—"}</strong><strong>{overview.data.runtime.network || "网络未知"}</strong></div>}
          <div className="carbon-node-grid">
            {(overview.data?.nodes ?? []).map((node) => <button type="button" key={node.node_id} className={`carbon-node-card ${node.node_id === nodeId ? "selected" : ""}`} onClick={() => setNodeId(node.node_id)}>
              <span>Node {node.node_id}</span><Badge tone={node.status === "has_data" ? "success" : "neutral"}>{statusText(node.status)}</Badge>
              <small>最新采样 {formatDateTime(node.latest_sample_at)} · 最新通量 {formatDateTime(node.latest_flux_at)}</small>
            </button>)}
          </div>
        </>}
      </Panel>

      <Panel className="carbon-flux-panel section-gap">
        <div className="carbon-data-toolbar">
          <div><h2 className="panel-title">通量成果</h2><div className="panel-kicker">选择节点、地块和时间范围查看 NEE、ER、GPP</div></div>
          <div className="carbon-selects">
            <label><span>节点</span><select value={nodeId} onChange={(event) => setNodeId(Number(event.target.value))}>{Array.from({ length: overview.data?.nodes_count ?? 1 }, (_, index) => <option key={index + 1} value={index + 1}>Node {index + 1}</option>)}</select></label>
            <label><span>地块</span><select value={field} onChange={(event) => setField(event.target.value)} disabled={!fieldOptions.length}>{fieldOptions.length ? fieldOptions.map((value) => <option key={value} value={value}>{value} 地块</option>) : <option value="">暂无地块</option>}</select></label>
          </div>
        </div>
        <div className="carbon-query-toolbar">
          <div className="carbon-time-range">
            <label><span>开始时间</span><input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
            <label><span>结束时间</span><input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
            <Button disabled={invalidRange} onClick={applyRange}><Search size={14} />查询</Button>
          </div>
          <div className="chart-mode" aria-label="通量图表视图">
            <button type="button" className={chartMode === "separate" ? "active" : ""} onClick={() => setChartMode("separate")}>分指标</button>
            <button type="button" className={chartMode === "compare" ? "active" : ""} onClick={() => setChartMode("compare")}>叠加对比</button>
          </div>
        </div>
        {invalidRange && <div className="form-error carbon-range-error">结束时间必须晚于开始时间。</div>}
        {flux.isLoading ? <StateView type="loading" title="正在读取通量" description="" /> : flux.error ? <StateView type="error" title="通量读取失败" description={formatApiError(flux.error).message} /> : !flux.data?.points.length ? <StateView type="empty" title="暂无通量结果" description="当前节点和时间范围内还没有已计算的 NEE、ER、GPP。" /> : chartMode === "separate" ? <div className="carbon-metric-grid">{metricDefinitions.map((metric) => <CarbonMetricChart key={metric.key} metric={metric} points={flux.data?.points ?? []} selectedPeriod={selectedPeriod} onSelect={selectPeriodFromChart} />)}</div> : <CarbonCombinedChart points={flux.data.points} selectedPeriod={selectedPeriod} onSelect={selectPeriodFromChart} />}
      </Panel>

      {selectedSummary && <div ref={periodDetailRef} className="carbon-period-detail-anchor"><CarbonPeriodDetail detail={detail.data} loading={detail.isLoading} error={detail.error} /></div>}

      <Panel className="carbon-period-panel section-gap">
        <div className="panel-header"><div><h2 className="panel-title">周期与原始采样</h2><div className="panel-kicker">点击一个周期查看 light / black 两个气室的原始曲线</div></div><Download size={17} /></div>
        {periods.isLoading ? <StateView type="loading" title="正在读取周期" description="" /> : periods.error ? <StateView type="error" title="周期读取失败" description={formatApiError(periods.error).message} /> : !periods.data?.items.length ? <StateView type="empty" title="暂无采样周期" description="当前时间范围内没有原始采样记录。" /> : <div className="carbon-period-list">{periods.data.items.map((item) => <button type="button" key={item.period} className={`carbon-period-row ${item.period === selectedPeriod ? "selected" : ""}`} onClick={() => setSelectedPeriod(item.period)}><span><strong>{formatDateTime(item.period_at)}</strong><small className="mono">{item.period}</small></span><span>{item.fields.join("、") || "—"}</span><span>{item.flux_fields.length ? `通量：${item.flux_fields.join("、")}` : "暂无通量"}</span></button>)}</div>}
      </Panel>
    </div>
  );
}

function CarbonCombinedChart({ points, selectedPeriod, onSelect }: { points: CarbonFluxPoint[]; selectedPeriod: string; onSelect: (period: string) => void }) {
  const data = points.map((point) => ({ ...point, timestamp: Date.parse(point.period_at) }));
  const selectNearestPoint = (clientX: number, chart: HTMLDivElement) => {
    const dots = Array.from(chart.querySelectorAll<SVGGElement>(".carbon-combined-dot-hit"));
    const nearestIndex = dots.reduce((nearest, dot, index) => {
      const bounds = dot.getBoundingClientRect();
      const distance = Math.abs(clientX - (bounds.left + bounds.width / 2));
      return distance < nearest.distance ? { index, distance } : nearest;
    }, { index: -1, distance: Number.POSITIVE_INFINITY }).index;
    const point = data[nearestIndex];
    if (point) onSelect(point.period);
  };
  return <section className="carbon-combined-card"><div className="carbon-combined-heading"><div><strong>NEE、ER、GPP 叠加对比</strong><small>μg CO₂·m⁻²·s⁻¹</small></div><div className="carbon-combined-legend">{metricDefinitions.map((metric) => <span key={metric.key}><i style={{ background: metric.color }} />{metric.label}</span>)}</div></div><div className="carbon-chart carbon-combined-chart" aria-label="通量叠加对比趋势图" onMouseDownCapture={(event) => { if (event.button === 0) event.preventDefault(); }} onClickCapture={(event) => { if (event.button === 0) selectNearestPoint(event.clientX, event.currentTarget); }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}><CartesianGrid stroke="var(--soft-line)" vertical={false} /><XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value) => formatDateTime(new Date(Number(value)).toISOString())} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={48} /><Tooltip labelFormatter={(value) => formatDateTime(new Date(Number(value)).toISOString())} formatter={(value, name) => [formatNumber(Number(value)), String(name).toUpperCase()]} />{metricDefinitions.map((metric, index) => <Line key={metric.key} type="monotone" dataKey={metric.key} name={metric.label} stroke={metric.color} strokeWidth={2} dot={index === 0 ? (props: { cx?: number; cy?: number; payload?: { period?: string } }) => <g className="carbon-combined-dot-hit"><circle cx={props.cx} cy={props.cy} r={14} fill="transparent" stroke="transparent" /><circle cx={props.cx} cy={props.cy} r={props.payload?.period === selectedPeriod ? 5 : 2.5} fill={props.payload?.period === selectedPeriod ? metric.color : "var(--panel)"} stroke={metric.color} strokeWidth={2} /></g> : false} activeDot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div></section>;
}

function CarbonMetricChart({ metric, points, selectedPeriod, onSelect }: { metric: typeof metricDefinitions[number]; points: CarbonFluxPoint[]; selectedPeriod: string; onSelect: (period: string) => void }) {
  const data = points.map((point) => ({ ...point, timestamp: Date.parse(point.period_at), value: point[metric.key] }));
  const selectNearestPoint = (clientX: number, chart: HTMLDivElement) => {
    const dots = Array.from(chart.querySelectorAll<SVGGElement>(".carbon-flux-dot-hit"));
    const nearestIndex = dots.reduce((nearest, dot, index) => {
      const bounds = dot.getBoundingClientRect();
      const distance = Math.abs(clientX - (bounds.left + bounds.width / 2));
      return distance < nearest.distance ? { index, distance } : nearest;
    }, { index: -1, distance: Number.POSITIVE_INFINITY }).index;
    const point = data[nearestIndex];
    if (point) onSelect(point.period);
  };
  return <section className="carbon-metric-card"><div className="carbon-metric-card-heading"><div><span>{metric.label}</span><small>μg CO₂·m⁻²·s⁻¹</small></div><strong>{formatNumber(data.at(-1)?.value)}</strong></div><div className="carbon-chart" aria-label={`${metric.label} 通量趋势图`} onMouseDownCapture={(event) => { if (event.button === 0) event.preventDefault(); }} onClickCapture={(event) => { if (event.button === 0) selectNearestPoint(event.clientX, event.currentTarget); }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}><CartesianGrid stroke="var(--soft-line)" vertical={false} /><XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value) => formatDateTime(new Date(Number(value)).toISOString())} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={42} /><Tooltip labelFormatter={(value) => formatDateTime(new Date(Number(value)).toISOString())} formatter={(value) => [formatNumber(Number(value)), metric.label]} /><Line type="monotone" dataKey="value" stroke={metric.color} strokeWidth={2} dot={(props: { cx?: number; cy?: number; payload?: { period?: string } }) => <g className="carbon-flux-dot-hit"><circle cx={props.cx} cy={props.cy} r={14} fill="transparent" stroke="transparent" /><circle cx={props.cx} cy={props.cy} r={props.payload?.period === selectedPeriod ? 5 : 3} fill={props.payload?.period === selectedPeriod ? metric.color : "var(--panel)"} stroke={metric.color} strokeWidth={2} /></g>} activeDot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></section>;
}

function CarbonPeriodDetail({ detail, loading, error }: { detail?: CarbonPeriodDetail; loading: boolean; error: unknown }) {
  if (loading) return <Panel className="section-gap"><StateView type="loading" title="正在读取原始采样" description="" /></Panel>;
  if (error) return <Panel className="section-gap"><StateView type="error" title="原始采样读取失败" description={formatApiError(error).message} /></Panel>;
  if (!detail) return null;
  const chartRows = new Map<number, Record<string, unknown>>();
  detail.phases.forEach((phase) => {
    const start = phase.points.length ? Date.parse(phase.points[0].ts) : 0;
    phase.points.forEach((point) => {
      const elapsed = Math.round((Date.parse(point.ts) - start) / 1000);
      const row = chartRows.get(elapsed) ?? { elapsed };
      row[`${phase.room}_co2`] = point.co2;
      row[`${phase.room}_temperature`] = point.temperature;
      row[`${phase.room}_humidity`] = point.humidity;
      chartRows.set(elapsed, row);
    });
  });
  const chartData = Array.from(chartRows.values()).sort((left, right) => Number(left.elapsed) - Number(right.elapsed));
  return <Panel className="section-gap carbon-period-detail"><div className="panel-header"><div><h2 className="panel-title">{formatDateTime(detail.period_at)} · {detail.field} 地块</h2><div className="panel-kicker">Node {detail.node_id} · 周期 <span className="mono">{detail.period}</span></div></div><div className="carbon-flux-result">{detail.flux ? metricDefinitions.map((metric) => <span key={metric.key}><small>{metric.label}</small><strong>{formatNumber(detail.flux?.[metric.key])}</strong></span>) : <Badge tone="neutral">暂无通量结果</Badge>}</div></div>{detail.warnings?.map((warning) => <div className="command-note" key={warning}>{warning}</div>)}<div className="carbon-detail-charts"><CarbonRawChart data={chartData} title="CO₂ 对比" unit="ppm" lines={[{ key: "light_co2", name: "light", color: "#0f766e" }, { key: "black_co2", name: "black", color: "#475569" }]} /><CarbonRawChart data={chartData} title="温度对比" unit="℃" lines={[{ key: "light_temperature", name: "light", color: "#c2410c" }, { key: "black_temperature", name: "black", color: "#7c3aed" }]} /><CarbonRawChart data={chartData} title="湿度对比" unit="%" lines={[{ key: "light_humidity", name: "light", color: "#2563eb" }, { key: "black_humidity", name: "black", color: "#0891b2" }]} /></div><div className="carbon-phase-grid">{detail.phases.map((phase) => <div key={phase.room} className="carbon-phase-card"><div><strong>{phase.room === "light" ? "透明气室 · light" : "遮光气室 · black"}</strong><Badge tone={phase.complete ? "success" : "warning"}>{phase.samples} 条</Badge></div><small>{formatDateTime(phase.start_at)} — {formatDateTime(phase.end_at)}</small></div>)}</div></Panel>;
}

function CarbonRawChart({ data, title, unit, lines }: { data: Array<Record<string, unknown>>; title: string; unit: string; lines: Array<{ key: string; name: string; color: string }> }) {
  return <section className="carbon-raw-chart"><div className="carbon-raw-chart-title"><strong>{title}</strong><span>相对阶段秒数 · {unit}</span></div><div className="carbon-raw-chart-body"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}><CartesianGrid stroke="var(--soft-line)" vertical={false} /><XAxis dataKey="elapsed" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value) => `${Math.round(Number(value))}s`} tick={{ fill: "var(--muted)", fontSize: 10 }} /><YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} width={48} /><Tooltip labelFormatter={(value) => `${Math.round(Number(value))}s`} formatter={(value, name) => [formatNumber(Number(value)), String(name)]} />{lines.map((line) => <Line key={line.key} dataKey={line.key} name={line.name} stroke={line.color} strokeWidth={1.7} dot={false} connectNulls isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div></section>;
}
