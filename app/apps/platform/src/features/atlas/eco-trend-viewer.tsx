import { useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatApiError, type DataStream } from "@thcpn/api";
import { numberLabel, seriesSummary } from "./atlas-model";
import { ecoMetricColor } from "./eco-palette";
import type { useAtlasDevice } from "./use-atlas-device";

const OVERLAY_FALLBACK_COLORS = ["#34d399", "#38bdf8", "#fbbf24", "#a78bfa", "#fb923c"] as const;

type Props = {
  motionEnabled?: boolean;
  fullHeight?: boolean;
  streams: DataStream[];
  results: ReturnType<typeof useAtlasDevice>["results"];
  range: { start: string; end: string };
  focusedId: string | null;
  onFocus: (id: string) => void;
  compareIds?: string[];
  onToggleCompare?: (id: string) => void;
};

export function EcoTrendViewer({
  streams,
  results,
  range,
  focusedId,
  onFocus,
  compareIds = [],
  onToggleCompare,
  motionEnabled = false,
  fullHeight = false,
}: Props) {
  const index = Math.max(0, streams.findIndex((stream) => stream.id === focusedId));
  const stream = streams[index];
  const ids = streams.map((item) => item.id).join(",");

  useEffect(() => {
    if (stream && stream.id !== focusedId) onFocus(stream.id);
  }, [ids, focusedId, onFocus]);

  const activeStreams = useMemo(() => {
    if (!stream) return [];
    const overlays = compareIds
      .filter((id) => id !== stream.id)
      .map((id) => streams.find((s) => s.id === id))
      .filter((s): s is DataStream => Boolean(s))
      .slice(0, 2);
    return [stream, ...overlays];
  }, [stream, compareIds, streams]);

  // Assign distinct colors to each plotted series
  const seriesMeta = useMemo(() => {
    const used = new Set<string>();
    const primaryUnit = activeStreams[0]?.unit ?? "";
    let rightUnit: string | null = null;
    return activeStreams.map((item, idx) => {
      let color = ecoMetricColor(item.unit);
      if (used.has(color)) {
        color =
          OVERLAY_FALLBACK_COLORS.find((candidate) => !used.has(candidate)) ??
          OVERLAY_FALLBACK_COLORS[idx % OVERLAY_FALLBACK_COLORS.length];
      }
      used.add(color);

      const unit = item.unit ?? "";
      let yAxisId: "left" | "right" = "left";
      if (idx > 0 && unit !== primaryUnit) {
        if (rightUnit === null) rightUnit = unit;
        yAxisId = "right";
      }

      const result = results.get(item.id);
      const series = result?.data?.series.find((s) => s.data_stream_id === item.id);
      const summary = seriesSummary(series);
      return {
        stream: item,
        dataKey: `s${idx}`,
        color,
        yAxisId,
        result,
        series,
        summary,
      };
    });
  }, [activeStreams, results]);

  const primary = seriesMeta[0];
  const hasRightAxis = seriesMeta.some((entry) => entry.yAxisId === "right");
  const rightAxisEntry = seriesMeta.find((entry) => entry.yAxisId === "right");

  const mergedData = useMemo(() => {
    if (!seriesMeta.length) return [];
    if (seriesMeta.length === 1) {
      return seriesMeta[0].summary.points.map((point) => ({
        time: Date.parse(point.ts),
        s0: point.value,
      }));
    }
    const byTime = new Map<number, Record<string, number>>();
    for (const meta of seriesMeta) {
      for (const point of meta.summary.points) {
        const ts = Date.parse(point.ts);
        if (!Number.isFinite(ts)) continue;
        let row = byTime.get(ts);
        if (!row) {
          row = { time: ts };
          byTime.set(ts, row);
        }
        row[meta.dataKey] = point.value;
      }
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }, [seriesMeta]);

  const computeDomain = (axis: "left" | "right"): [number, number] => {
    const entries = seriesMeta.filter((m) => m.yAxisId === axis);
    const mins = entries.map((m) => m.summary.min).filter((v): v is number => v != null);
    const maxs = entries.map((m) => m.summary.max).filter((v): v is number => v != null);
    const min = mins.length ? Math.min(...mins) : 0;
    const max = maxs.length ? Math.max(...maxs) : 0;
    const pad = max > min ? (max - min) * 0.14 : Math.max(Math.abs(min) * 0.02, 0.01);
    return [min - pad, max + pad];
  };

  const leftDomain = computeDomain("left");
  const rightDomain = hasRightAxis ? computeDomain("right") : undefined;
  const multiDay = Date.parse(range.end) - Date.parse(range.start) > 86400000;
  const gradientId = `eco-focus-fill-${stream?.id ?? "empty"}`;

  const availableOverlays = streams.filter(
    (item) => item.id !== stream?.id && !compareIds.includes(item.id),
  );

  const anyLoading = seriesMeta.some((m) => m.result?.isFetching && !m.series);
  const primaryError = primary?.series?.error ?? (primary?.result?.error ? formatApiError(primary.result.error).message : null);

  return (
    <section className={`eco-trend-viewer${fullHeight ? " is-full-height" : ""}`}>
      <header className="eco-section-heading">
        <h3>数据趋势</h3>
        <span>{stream?.unit}</span>
      </header>

      <div className="eco-trend-controls">
        <select
          aria-label="趋势指标"
          value={stream?.id ?? ""}
          disabled={!streams.length}
          onChange={(event) => onFocus(event.target.value)}
        >
          {streams.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <div className="eco-trend-pager">
          <button
            type="button"
            aria-label="上一指标"
            disabled={index === 0 || !streams.length}
            onClick={() => onFocus(streams[index - 1].id)}
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            {streams.length ? index + 1 : 0} / {streams.length}
          </span>
          <button
            type="button"
            aria-label="下一指标"
            disabled={index >= streams.length - 1}
            onClick={() => onFocus(streams[index + 1].id)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Multi-Metric Overlay Comparison Legend & Picker */}
      {onToggleCompare && stream && streams.length > 1 && (
        <div className="obs-compare-bar" aria-label="指标叠加对比">
          {seriesMeta.map((meta, idx) => (
            <span
              key={meta.stream.id}
              className={`obs-compare-chip${idx === 0 ? " is-primary" : ""}`}
              style={{ "--chip-color": meta.color } as React.CSSProperties}
            >
              <i aria-hidden="true" />
              <span>{meta.stream.name}</span>
              {meta.stream.unit && <small>{meta.stream.unit}</small>}
              {idx > 0 && (
                <button
                  type="button"
                  aria-label={`移除对比 ${meta.stream.name}`}
                  onClick={() => onToggleCompare(meta.stream.id)}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          {seriesMeta.length < 3 && availableOverlays.length > 0 && (
            <label className="obs-compare-add">
              <Plus size={11} aria-hidden="true" />
              <select
                aria-label="叠加对比指标"
                value=""
                onChange={(event) => {
                  if (event.target.value) onToggleCompare(event.target.value);
                }}
              >
                <option value="">叠加对比</option>
                {availableOverlays.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.unit ? ` (${item.unit})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* Primary Metric Extrema */}
      {primary && primary.summary.points.length > 0 && (
        <div className="obs-trend-extrema">
          <span>
            <small>MIN</small>
            <b>{numberLabel(primary.summary.min)}</b>
          </span>
          <span>
            <small>MAX</small>
            <b>{numberLabel(primary.summary.max)}</b>
          </span>
          {primary.summary.latest && (
            <span>
              <small>LATEST</small>
              <b>{numberLabel(primary.summary.latest.value)}</b>
            </span>
          )}
        </div>
      )}

      <div className="eco-trend-plot" aria-label={stream ? `${stream.name}趋势图` : "数据趋势图"}>
        {!stream ? (
          <div className="eco-data-state">请选择关注指标</div>
        ) : anyLoading && !mergedData.length ? (
          <div className="eco-data-state" role="status">
            正在加载…
          </div>
        ) : primaryError && !mergedData.length ? (
          <div className="eco-data-state" role="alert">
            {primaryError}
          </div>
        ) : !mergedData.length ? (
          <div className="eco-data-state">暂无数据</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={mergedData}
              margin={{ top: 12, right: hasRightAxis ? 4 : 10, bottom: 4, left: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={primary.color} stopOpacity={0.34} />
                  <stop offset="85%" stopColor={primary.color} stopOpacity={0.03} />
                  <stop offset="100%" stopColor={primary.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 4" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                domain={[Date.parse(range.start), Date.parse(range.end)]}
                tickFormatter={(time) =>
                  multiDay
                    ? new Date(time).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
                    : new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
                }
                tick={{ fill: "#94a3b8", fontSize: 10.5 }}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                tickLine={false}
                minTickGap={28}
                tickCount={5}
              />
              <YAxis
                yAxisId="left"
                width={46}
                domain={leftDomain}
                tick={{ fill: hasRightAxis ? primary.color : "#94a3b8", fontSize: 10.5 }}
                tickFormatter={numberLabel}
                axisLine={false}
                tickLine={false}
                tickCount={5}
              />
              {hasRightAxis && rightDomain && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={46}
                  domain={rightDomain}
                  tick={{ fill: rightAxisEntry?.color ?? "#38bdf8", fontSize: 10.5 }}
                  tickFormatter={numberLabel}
                  axisLine={false}
                  tickLine={false}
                  tickCount={5}
                />
              )}
              <Tooltip
                contentStyle={{
                  background: "rgba(8, 14, 22, 0.94)",
                  border: "1px solid rgba(255, 255, 255, 0.14)",
                  borderRadius: 10,
                  color: "#f1f5f9",
                  fontSize: 12,
                  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.48)",
                  backdropFilter: "blur(12px)",
                }}
                labelStyle={{ color: "#94a3b8", marginBottom: 4, fontSize: 11 }}
                labelFormatter={(time) => new Date(Number(time)).toLocaleString("zh-CN")}
              />
              <Area
                key={primary.stream.id}
                yAxisId="left"
                type="monotone"
                dataKey="s0"
                name={primary.stream.name}
                unit={primary.stream.unit}
                stroke={primary.color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={motionEnabled}
                animationDuration={460}
                animationEasing="ease-out"
                dot={false}
                activeDot={{ r: 4.5, stroke: "#070d14", strokeWidth: 2, fill: primary.color }}
                connectNulls={seriesMeta.length > 1}
              />
              {seriesMeta.slice(1).map((meta) => (
                <Line
                  key={meta.stream.id}
                  yAxisId={meta.yAxisId}
                  type="monotone"
                  dataKey={meta.dataKey}
                  name={meta.stream.name}
                  unit={meta.stream.unit}
                  stroke={meta.color}
                  strokeWidth={1.8}
                  strokeDasharray={meta.yAxisId === "right" ? undefined : "4 2"}
                  isAnimationActive={motionEnabled}
                  animationDuration={460}
                  animationEasing="ease-out"
                  dot={false}
                  activeDot={{ r: 4, stroke: "#070d14", strokeWidth: 2, fill: meta.color }}
                  connectNulls
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
