import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartNoAxesCombined, PanelsTopLeft } from "lucide-react";
import type { TelemetrySeries } from "@thcpn/api";

const chartColors = ["#1769e0", "#16845b", "#d36b12", "#b13e4a", "#6a5ab5"];
const numberFormat = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
const formatTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(value))
    : "—";
export const healthyTelemetryQuality = (quality?: string) =>
  ["good", "valid", "ok"].includes((quality ?? "").toLowerCase());

export function TelemetryCharts({
  series,
  startTime,
  endTime,
  compact = false,
}: {
  series: TelemetrySeries[];
  startTime: string;
  endTime: string;
  compact?: boolean;
}) {
  const available = series.filter((item) =>
    item.points.some((point) => Number.isFinite(point.value)),
  );
  const [mode, setMode] = useState<"compare" | "separate">(
    available.length > 1 ? "compare" : "separate",
  );
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = compact
    ? available
    : available.filter((item) => !hidden.includes(item.data_stream_id));
  const activeMode = compact && available.length > 1 ? "compare" : mode;
  const toggle = (id: string) =>
    setHidden((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  return (
    <div className={`telemetry-visualization ${compact ? "compact" : ""}`}>
      {!compact && (
        <div className="chart-toolbar">
          <div className="chart-mode" aria-label="图表显示方式">
            <button
              type="button"
              className={mode === "compare" ? "active" : ""}
              onClick={() => setMode("compare")}
              disabled={available.length < 2}
            >
              <ChartNoAxesCombined size={13} />
              叠加对比
            </button>
            <button
              type="button"
              className={mode === "separate" ? "active" : ""}
              onClick={() => setMode("separate")}
            >
              <PanelsTopLeft size={13} />
              分指标
            </button>
          </div>
          <div className="chart-series-toggles" aria-label="显示的数据指标">
            {available.map((item, index) => (
              <button
                type="button"
                key={item.data_stream_id}
                className={
                  hidden.includes(item.data_stream_id) ? "muted-series" : ""
                }
                onClick={() => toggle(item.data_stream_id)}
                aria-pressed={!hidden.includes(item.data_stream_id)}
              >
                <i
                  style={{
                    background: chartColors[index % chartColors.length],
                  }}
                />
                {item.name}
                <small>{item.unit}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {activeMode === "compare" && available.length > 1 ? (
        <ComparisonChart
          series={visible}
          allSeries={available}
          startTime={startTime}
          endTime={endTime}
        />
      ) : (
        <div className="telemetry-charts">
          {visible.map((item) => (
            <TelemetryChart
              key={item.data_stream_id}
              series={item}
              colorIndex={available.indexOf(item)}
              startTime={startTime}
              endTime={endTime}
            />
          ))}
        </div>
      )}
      {!compact && !visible.length && (
        <div className="chart-all-hidden">
          已隐藏全部指标，点击上方图例恢复显示。
        </div>
      )}
    </div>
  );
}

function ComparisonChart({
  series,
  allSeries,
  startTime,
  endTime,
}: {
  series: TelemetrySeries[];
  allSeries: TelemetrySeries[];
  startTime: string;
  endTime: string;
}) {
  const { data, stats } = useMemo(() => {
    const nextStats = new Map<string, { min: number; max: number }>();
    series.forEach((item) => {
      const values = item.points
        .map((point) => point.value)
        .filter(Number.isFinite);
      nextStats.set(item.data_stream_id, {
        min: Math.min(...values),
        max: Math.max(...values),
      });
    });
    const rows = new Map<number, Record<string, number | string>>();
    series.forEach((item) => {
      const itemStats = nextStats.get(item.data_stream_id)!;
      const step = Math.max(1, Math.ceil(item.points.length / 600));
      item.points.forEach((point, index) => {
        if (index % step !== 0 && index !== item.points.length - 1) return;
        const time = Date.parse(point.ts);
        if (!Number.isFinite(time) || !Number.isFinite(point.value)) return;
        const row = rows.get(time) ?? { time };
        const spread = itemStats.max - itemStats.min;
        row[item.data_stream_id] = spread
          ? ((point.value - itemStats.min) / spread) * 100
          : 50;
        row[`${item.data_stream_id}:raw`] = point.value;
        row[`${item.data_stream_id}:quality`] = point.quality;
        rows.set(time, row);
      });
    });
    return {
      data: [...rows.values()].sort((a, b) => Number(a.time) - Number(b.time)),
      stats: nextStats,
    };
  }, [series]);
  const returnedTotal = series.reduce(
    (count, item) => count + item.points.length,
    0,
  );
  const sourceTotal = series.reduce(
    (count, item) => count + (item.source_count || item.points.length),
    0,
  );
  const sampled = series.some((item) => item.sampled);
  const complete = series.every((item) => item.complete);
  return (
    <div className="comparison-chart">
      <div className="comparison-summary">
        <span>
          <strong>{series.length}</strong>显示指标
        </span>
        <span>
          <strong>{sourceTotal}</strong>原始点
        </span>
        <span>
          <strong>{returnedTotal}</strong>
          {sampled ? "绘图点" : "数据点"}
        </span>
        <span className="normalization-note">
          {complete ? "完整时间范围" : "数据源可能已截断"} ·
          各指标按自身区间归一化
        </span>
      </div>
      <div
        className="comparison-canvas"
        role="img"
        aria-label="多指标归一化趋势对比"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 18, right: 18, bottom: 4, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--soft-line)"
              strokeDasharray="3 4"
            />
            <XAxis
              type="number"
              dataKey="time"
              domain={[Date.parse(startTime), Date.parse(endTime)]}
              tickFormatter={(value) =>
                formatTime(new Date(value).toISOString()).slice(0, 11)
              }
              minTickGap={54}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(value) => `${value}%`}
              width={42}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              labelFormatter={(value) =>
                formatTime(new Date(Number(value)).toISOString())
              }
              formatter={(_value, name, item) => {
                const current = series.find(
                  (entry) => entry.data_stream_id === name,
                );
                const raw = item.payload[`${name}:raw`];
                const quality = item.payload[`${name}:quality`];
                return [
                  `${numberFormat(Number(raw))}${current?.unit ? ` ${current.unit}` : ""} · ${healthyTelemetryQuality(String(quality)) ? "正常" : quality}`,
                  current?.name ?? String(name),
                ];
              }}
              contentStyle={{
                border: "1px solid var(--line)",
                borderRadius: 6,
                boxShadow: "0 8px 24px rgba(24,49,73,.12)",
              }}
            />
            {series.map((item) => (
              <Line
                key={item.data_stream_id}
                type="monotone"
                dataKey={item.data_stream_id}
                name={item.data_stream_id}
                stroke={
                  chartColors[allSeries.indexOf(item) % chartColors.length]
                }
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: "white" }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="comparison-ranges">
        {series.map((item) => {
          const itemStats = stats.get(item.data_stream_id);
          return (
            <span key={item.data_stream_id}>
              <i
                style={{
                  background:
                    chartColors[allSeries.indexOf(item) % chartColors.length],
                }}
              />
              <strong>{item.name}</strong>
              {itemStats
                ? `${numberFormat(itemStats.min)}–${numberFormat(itemStats.max)} ${item.unit}`
                : "—"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TelemetryChart({
  series,
  colorIndex,
  startTime,
  endTime,
}: {
  series: TelemetrySeries;
  colorIndex: number;
  startTime: string;
  endTime: string;
}) {
  const source = series.points
    .filter(
      (point) =>
        Number.isFinite(point.value) && Number.isFinite(Date.parse(point.ts)),
    )
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (!source.length) return null;
  const step = Math.max(1, Math.ceil(source.length / 600));
  const data = source
    .filter((_, index) => index % step === 0 || index === source.length - 1)
    .map((point) => ({ ...point, time: Date.parse(point.ts) }));
  const values = source.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = values.reduce((sum, item) => sum + item, 0) / source.length;
  const latest = source.at(-1);
  const first = source[0];
  const good = source.filter((point) =>
    healthyTelemetryQuality(point.quality),
  ).length;
  const quality = Math.round((good / source.length) * 100);
  const change = first && latest ? latest.value - first.value : 0;
  const changePercent = first?.value
    ? (change / Math.abs(first.value)) * 100
    : null;
  const domainPadding = Math.max((max - min) * 0.08, Math.abs(max || 1) * 0.01);
  return (
    <section className={`telemetry-chart chart-color-${colorIndex % 5}`}>
      <header>
        <div>
          <div className="cell-title">{series.name}</div>
          <div className="cell-sub mono">
            {series.code} · {series.source_count || source.length} 个原始点
            {series.sampled ? ` · ${source.length} 个绘图点` : ""}
          </div>
        </div>
        <div className="chart-latest">
          <strong>{latest ? numberFormat(latest.value) : "—"}</strong>
          <span>{series.unit}</span>
        </div>
      </header>
      <div className="chart-stats">
        <span>
          最小 <strong>{numberFormat(min)}</strong>
        </span>
        <span>
          {series.sampled ? "绘图点均值" : "平均"}{" "}
          <strong>{numberFormat(average)}</strong>
        </span>
        <span>
          最大 <strong>{numberFormat(max)}</strong>
        </span>
        <span>
          {series.sampled ? "绘图点质量" : "质量"} <strong>{quality}%</strong>
        </span>
        <span>
          区间变化{" "}
          <strong
            className={change > 0 ? "trend-up" : change < 0 ? "trend-down" : ""}
          >
            {change > 0 ? "+" : ""}
            {numberFormat(change)}
            {changePercent === null
              ? ""
              : ` (${changePercent > 0 ? "+" : ""}${changePercent.toFixed(1)}%)`}
          </strong>
        </span>
      </div>
      <div
        className="chart-canvas"
        role="img"
        aria-label={`${series.name}时间序列趋势`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 12, right: 8, bottom: 2, left: 0 }}
          >
            <defs>
              <linearGradient
                id={`telemetry-fill-${colorIndex}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="var(--chart)" stopOpacity={0.2} />
                <stop
                  offset="100%"
                  stopColor="var(--chart)"
                  stopOpacity={0.01}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--soft-line)"
              strokeDasharray="3 4"
            />
            <XAxis
              type="number"
              dataKey="time"
              domain={[Date.parse(startTime), Date.parse(endTime)]}
              tickFormatter={(value) =>
                formatTime(new Date(value).toISOString()).slice(0, 11)
              }
              minTickGap={48}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              domain={[min - domainPadding, max + domainPadding]}
              tickFormatter={numberFormat}
              width={48}
              tickLine={false}
              axisLine={false}
            />
            <ReferenceLine
              y={average}
              stroke="var(--chart)"
              strokeOpacity={0.35}
              strokeDasharray="4 4"
            />
            <Tooltip
              cursor={{
                stroke: "var(--chart)",
                strokeOpacity: 0.45,
                strokeDasharray: "3 3",
              }}
              labelFormatter={(value) =>
                formatTime(new Date(Number(value)).toISOString())
              }
              formatter={(value, _name, item) => [
                `${numberFormat(Number(value))}${series.unit ? ` ${series.unit}` : ""}`,
                healthyTelemetryQuality(item.payload.quality)
                  ? "正常"
                  : `质量：${item.payload.quality}`,
              ]}
              contentStyle={{
                border: "1px solid var(--line)",
                borderRadius: 6,
                boxShadow: "0 8px 24px rgba(24,49,73,.12)",
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart)"
              strokeWidth={2}
              fill={`url(#telemetry-fill-${colorIndex})`}
              dot={
                data.length <= 48
                  ? { r: 2, fill: "white", strokeWidth: 1.5 }
                  : false
              }
              activeDot={{
                r: 4,
                fill: "white",
                stroke: "var(--chart)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        <span>
          <i className="legend-line" />
          实时值
        </span>
        <span>
          <i className="legend-average" />
          {series.sampled ? "绘图点均值" : "区间平均"} {numberFormat(average)}
        </span>
        {quality < 100 && (
          <span className="quality-alert">
            {source.length - good} 个非正常质量点
          </span>
        )}
      </div>
      {series.warnings?.length ? (
        <div className="chart-warning">
          {series.warnings.map((warning) => warning.message).join("；")}
        </div>
      ) : null}
    </section>
  );
}
