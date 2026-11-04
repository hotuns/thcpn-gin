import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatApiError, type DataStream } from "@thcpn/api";
import { numberLabel, seriesSummary } from "./atlas-model";
import { ecoMetricColor } from "./eco-palette";
import type { useAtlasDevice } from "./use-atlas-device";

type Props = {
  motionEnabled?: boolean;
  streams: DataStream[];
  results: ReturnType<typeof useAtlasDevice>["results"];
  range: { start: string; end: string };
  focusedId: string | null;
  onFocus: (id: string) => void;
};

export function EcoTrendViewer({ streams, results, range, focusedId, onFocus, motionEnabled = false }: Props) {
  const index = Math.max(0, streams.findIndex(stream => stream.id === focusedId));
  const stream = streams[index];
  const ids = streams.map(item => item.id).join(",");
  useEffect(() => {
    if (stream && stream.id !== focusedId) onFocus(stream.id);
  }, [ids, focusedId, onFocus]);
  const result = stream ? results.get(stream.id) : undefined;
  const series = result?.data?.series.find(item => item.data_stream_id === stream?.id);
  const summary = seriesSummary(series);
  const color = ecoMetricColor(stream?.unit);
  const gradient = `eco-focus-fill-${stream?.id ?? "empty"}`;
  const minimum = summary.min ?? 0;
  const maximum = summary.max ?? 0;
  const padding = maximum > minimum ? (maximum - minimum) * 0.12 : Math.max(Math.abs(minimum) * 0.02, 0.01);
  const domain: [number, number] = [minimum - padding, maximum + padding];
  return <section className="eco-trend-viewer">
    <header className="eco-section-heading"><h3>数据趋势</h3><span>{stream?.unit}</span></header>
    <div className="eco-trend-controls">
      <select aria-label="趋势指标" value={stream?.id ?? ""} disabled={!streams.length} onChange={event => onFocus(event.target.value)}>{streams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <div className="eco-trend-pager"><button type="button" aria-label="上一指标" disabled={index === 0 || !streams.length} onClick={() => onFocus(streams[index - 1].id)}><ChevronLeft size={15} /></button><span>{streams.length ? index + 1 : 0} / {streams.length}</span><button type="button" aria-label="下一指标" disabled={index >= streams.length - 1} onClick={() => onFocus(streams[index + 1].id)}><ChevronRight size={15} /></button></div>
    </div>
    <div className="eco-trend-plot" aria-label={stream ? `${stream.name}趋势图` : "数据趋势图"}>
      {!stream ? <div className="eco-data-state">请选择关注指标</div> : result?.isFetching && !series ? <div className="eco-data-state" role="status">正在加载…</div> : result?.error || series?.error ? <div className="eco-data-state" role="alert">{series?.error ?? formatApiError(result?.error).message}</div> : !summary.points.length ? <div className="eco-data-state">暂无数据</div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={summary.points.map(point => ({ time: Date.parse(point.ts), value: point.value }))} margin={{ top: 16, right: 16, bottom: 8, left: 2 }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.34} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid stroke="#214b68" strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="time" type="number" domain={[Date.parse(range.start), Date.parse(range.end)]} tickFormatter={time => new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#c3dcef", fontSize: 11 }} axisLine={{ stroke: "#64839a" }} tickLine={false} minTickGap={26} tickCount={5} />
        <YAxis width={52} domain={domain} tick={{ fill: "#c3dcef", fontSize: 11 }} tickFormatter={numberLabel} axisLine={{ stroke: "#64839a" }} tickLine={false} tickCount={5} />
        <Tooltip contentStyle={{ background: "#06233b", border: "1px solid #1c779b", borderRadius: 2, color: "#dcefff", fontSize: 12 }} labelFormatter={time => new Date(Number(time)).toLocaleString("zh-CN")} />
        <Area key={stream.id} dataKey="value" name={stream.name} unit={stream.unit} stroke={color} strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={motionEnabled} animationDuration={500} animationEasing="ease-out" dot={false} connectNulls={false} />
      </AreaChart></ResponsiveContainer>}
    </div>
  </section>;
}
