import type { ReactNode } from "react";
import { useId, useMemo, useRef, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartNoAxesCombined, PanelsTopLeft, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, IconButton } from "../ui";
import type { TelemetrySeries } from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";
import "./telemetry-mobile.css";
import { useChartZoom } from "./chart-zoom";

const chartColors = ["#1769e0", "#16845b", "#d36b12", "#b13e4a", "#6a5ab5"];
const seriesColor = (index: number, distinct: boolean) => distinct
  ? `hsl(${(218 + index * 137.508) % 360} 65% ${[40, 48, 35][index % 3]}%)`
  : chartColors[index % chartColors.length];
const windDirectionLabel = (value: number) => ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][Math.round((value % 360) / 45) % 8];
const normalizedCode = (series: TelemetrySeries) => series.code.trim().toLowerCase();
const isWindSpeed = (series: TelemetrySeries) => ["wind_sp", "wind_speed"].includes(normalizedCode(series));
const isWindDirection = (series: TelemetrySeries) => ["wind_d", "wind_direction"].includes(normalizedCode(series));

type WindArrowProps = {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: { windDirection?: number };
  stroke?: string;
};

function WindArrow({ cx, cy, payload, stroke = "var(--chart)" }: WindArrowProps) {
  const direction = payload?.windDirection;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(direction)) return <g />;
  return (
    <g transform={`translate(${cx} ${cy}) rotate(${direction})`} aria-label={`风向 ${direction}° ${windDirectionLabel(direction!)}`}>
      <path d="M0 5V-5M0-5L-3-1M0-5L3-1" fill="none" stroke="var(--surface)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0 5V-5M0-5L-3-1M0-5L3-1" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export function TelemetryCharts({
  series,
  startTime,
  endTime,
  compact = false,
  displayMode,
}: {
  series: TelemetrySeries[];
  startTime: string;
  endTime: string;
  compact?: boolean;
  displayMode?: "compare" | "separate";
}) {
  const { t } = useLocale();
  const available = series.filter((item) =>
    item.points.some((point) => Number.isFinite(point.value)),
  );
  const fixedComparison = displayMode === "compare" && !compact;
  const distinctColors = fixedComparison && available.length > chartColors.length;
  const windDirectionSeries = fixedComparison ? undefined : available.find(isWindDirection);
  const windSpeedSeries = available.find(isWindSpeed);
  const chartSeries = windDirectionSeries && windSpeedSeries
    ? available.filter((item) => !isWindDirection(item))
    : available;
  const [mode, setMode] = useState<"compare" | "separate">(
    "separate",
  );
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = compact
    ? chartSeries
    : chartSeries.filter((item) => !hidden.includes(item.data_stream_id));
  const activeMode = displayMode ?? (compact && chartSeries.length > 1 ? "compare" : mode);
  const toggle = (id: string) =>
    setHidden((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  const legend = (
    <div className={`chart-series-toggles${fixedComparison ? " comparison-series-list" : ""}`} aria-label={t("platform:telemetry.visibleMetrics")}>
      {chartSeries.map((item, index) => (
        <button
          type="button"
          key={item.data_stream_id}
          className={
            hidden.includes(item.data_stream_id) ? "muted-series" : ""
          }
          title={item.name}
          onClick={() => toggle(item.data_stream_id)}
          aria-pressed={!hidden.includes(item.data_stream_id)}
        >
          <i
            style={{
              background: seriesColor(index, distinctColors),
            }}
          />
          <span>{item.name}{isWindSpeed(item) && windDirectionSeries ? " · 风向" : ""}</span>
          <small>{item.unit}</small>
        </button>
      ))}
    </div>
  );
  const seriesPicker = fixedComparison && chartSeries.length > 8 ? (
    <details className="comparison-series-picker">
      <summary>{t("platform:telemetry.visibleMetrics")} · {visible.length}/{chartSeries.length}</summary>
      {legend}
    </details>
  ) : legend;
  return (
    <div className={`telemetry-visualization ${compact ? "compact" : ""}`}>
      {!compact && (
        <div className={`chart-toolbar${fixedComparison ? " comparison-series-toolbar" : ""}`}>
        {!displayMode && <div className="chart-mode" aria-label={t("platform:telemetry.displayMode")}>
            <button
              type="button"
              className={mode === "compare" ? "active" : ""}
              onClick={() => setMode("compare")}
              disabled={chartSeries.length < 2}
            >
              <ChartNoAxesCombined size={13} />
              {t("platform:telemetry.compare")}
            </button>
            <button
              type="button"
              className={mode === "separate" ? "active" : ""}
              onClick={() => setMode("separate")}
            >
              <PanelsTopLeft size={13} />
              {t("platform:telemetry.separate")}
            </button>
          </div>}
          {seriesPicker}
        </div>
      )}
      {activeMode === "compare" && chartSeries.length > 1 ? (
        <ComparisonChart
          series={visible}
          allSeries={chartSeries}
          windDirectionSeries={windDirectionSeries}
          startTime={startTime}
          endTime={endTime}
          zoomable={!compact}
          fixedComparison={fixedComparison}
          seriesPicker={fixedComparison ? seriesPicker : undefined}
        />
      ) : (
        <div className="telemetry-charts">
          {visible.map((item) => (
            <TelemetryChart
              key={item.data_stream_id}
              series={item}
              colorIndex={chartSeries.indexOf(item)}
              windDirectionSeries={isWindSpeed(item) ? windDirectionSeries : undefined}
              startTime={startTime}
              endTime={endTime}
              zoomable={!compact}
            />
          ))}
        </div>
      )}
      {!compact && !visible.length && (
        <div className="chart-all-hidden">
          {t("platform:telemetry.allHidden")}
        </div>
      )}
    </div>
  );
}

function ComparisonChart({
  series,
  allSeries,
  windDirectionSeries,
  startTime,
  endTime,
  zoomable,
  expanded = false,
  fixedComparison = false,
  seriesPicker,
}: {
  series: TelemetrySeries[];
  allSeries: TelemetrySeries[];
  windDirectionSeries?: TelemetrySeries;
  startTime: string;
  endTime: string;
  zoomable: boolean;
  expanded?: boolean;
  fixedComparison?: boolean;
  seriesPicker?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expandButton = useRef<HTMLButtonElement | null>(null);
  const { t, formatNumber, formatDateTime } = useLocale();
  const sameMetric = allSeries.length > 0 && allSeries.every(item => normalizedCode(item) === normalizedCode(allSeries[0]) && item.unit === allSeries[0].unit);
  const normalized = !fixedComparison || !sameMetric;
  const title = t(normalized ? "platform:telemetry.normalizedChart" : "platform:telemetry.nodeChart");
  const colorFor = (item: TelemetrySeries) => seriesColor(allSeries.indexOf(item), fixedComparison && allSeries.length > chartColors.length);
  const { data, stats } = useMemo(() => {
    const directionByTime = new Map(
      windDirectionSeries?.points
        .filter((point) => Number.isFinite(point.value) && Number.isFinite(Date.parse(point.ts)))
        .map((point) => [Date.parse(point.ts), point.value]) ?? [],
    );
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
      item.points.forEach((point) => {
        const time = Date.parse(point.ts);
        if (!Number.isFinite(time) || !Number.isFinite(point.value)) return;
        const row = rows.get(time) ?? { time };
        const spread = itemStats.max - itemStats.min;
        row[item.data_stream_id] = !normalized ? point.value : spread
          ? ((point.value - itemStats.min) / spread) * 100
          : 50;
        row[`${item.data_stream_id}:raw`] = point.value;
        if (isWindSpeed(item)) row.windDirection = directionByTime.get(time) ?? "";
        rows.set(time, row);
      });
    });
    return {
      data: [...rows.values()].sort((a, b) => Number(a.time) - Number(b.time)),
      stats: nextStats,
    };
  }, [series, windDirectionSeries, normalized]);
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
  const zoom = useChartZoom(Date.parse(startTime), Date.parse(endTime));
  return (
    <div className="comparison-chart">
      <div className="comparison-summary">
        <span>
          <strong>{series.length}</strong>{t("platform:telemetry.metricCount")}
        </span>
        <span>
          <strong>{sourceTotal}</strong>{t("platform:telemetry.sourcePoints")}
        </span>
        <span>
          <strong>{returnedTotal}</strong>
          {sampled ? t("platform:telemetry.chartPoints") : t("platform:telemetry.dataPoints")}
        </span>
        <span className="normalization-note">
          {complete ? t("platform:telemetry.complete") : t("platform:telemetry.truncated")}{normalized ? ` · ${t("platform:telemetry.normalized")}` : allSeries[0]?.unit ? ` · ${allSeries[0].unit}` : ""}
        </span>
      </div>
      {zoomable && !expanded && <div className="telemetry-chart-controls"><IconButton label={t("platform:telemetry.expand")} onClick={(event) => { expandButton.current = event.currentTarget; setOpen(true); }}><Maximize2 size={16}/></IconButton></div>}
      {!open && <div
        className="comparison-canvas"
        role="img"
        aria-label={title}
        {...(zoomable ? zoom.interactionProps : {})}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 18, right: 18, bottom: 4, left: 12 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--soft-line)"
              strokeDasharray="3 4"
            />
            <XAxis
              type="number"
              dataKey="time"
              domain={zoomable ? zoom.domain : [Date.parse(startTime), Date.parse(endTime)]}
              allowDataOverflow={zoomable}
              tickFormatter={(value) =>
                formatDateTime(new Date(value), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
              }
              minTickGap={54}
              tick={{ fontSize: 13 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              domain={normalized ? [0, 100] : ["auto", "auto"]}
              ticks={normalized ? [0, 25, 50, 75, 100] : undefined}
              tickFormatter={normalized ? (value) => `${value}%` : undefined}
              width="auto" tickMargin={10}
              tick={{ fontSize: 13 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              active={zoom.isDragging ? false : undefined}
              labelFormatter={(value) =>
                formatDateTime(new Date(Number(value)), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
              }
              formatter={(_value, name, item) => {
                const current = series.find(
                  (entry) => entry.data_stream_id === name,
                );
                const raw = item.payload[`${name}:raw`];
                return [
                  `${formatNumber(Number(raw), { maximumFractionDigits: 2 })}${current?.unit ? ` ${current.unit}` : ""}`,
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
                  colorFor(item)
                }
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: "white" }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            {series.filter(isWindSpeed).map((item) => (
              <Scatter
                key={`${item.data_stream_id}:wind-direction`}
                dataKey={item.data_stream_id}
                fill="transparent"
                shape={(props) => <WindArrow {...props as WindArrowProps} stroke={colorFor(item)} />}
                isAnimationActive={false}
                legendType="none"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>}
      {!fixedComparison && <div className="comparison-ranges">
        {series.map((item) => {
          const itemStats = stats.get(item.data_stream_id);
          return (
            <span key={item.data_stream_id}>
              <i
                style={{
                  background:
                    colorFor(item),
                }}
              />
              <strong>{item.name}</strong>
              {itemStats
                ? `${formatNumber(itemStats.min, { maximumFractionDigits: 2 })}–${formatNumber(itemStats.max, { maximumFractionDigits: 2 })} ${item.unit}`
                : "—"}
            </span>
          );
        })}
      </div>}
      {!expanded && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="telemetry-expanded-dialog" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); expandButton.current?.focus(); }}>
            <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
            {seriesPicker}
            {open && <ComparisonChart series={series} allSeries={allSeries} windDirectionSeries={windDirectionSeries} startTime={startTime} endTime={endTime} zoomable expanded fixedComparison={fixedComparison}/>}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export function TelemetryChart({
  series,
  colorIndex,
  windDirectionSeries,
  startTime,
  endTime,
  zoomable,
  expanded = false,
}: {
  series: TelemetrySeries;
  colorIndex: number;
  windDirectionSeries?: TelemetrySeries;
  startTime: string;
  endTime: string;
  zoomable: boolean;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expandButton = useRef<HTMLButtonElement | null>(null);
  const fillId = useId();
  const { t, formatNumber, formatDateTime } = useLocale();
  const source = series.points
    .filter(
      (point) =>
        Number.isFinite(point.value) && Number.isFinite(Date.parse(point.ts)),
    )
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const zoom = useChartZoom(Date.parse(startTime), Date.parse(endTime));
  if (!source.length) return null;
  const directionByTime = new Map(
    windDirectionSeries?.points
      .filter((point) => Number.isFinite(point.value) && Number.isFinite(Date.parse(point.ts)))
      .map((point) => [Date.parse(point.ts), point.value]) ?? [],
  );
  const data = source
    .map((point) => {
      const time = Date.parse(point.ts);
      return { ...point, time, windDirection: directionByTime.get(time) };
    });
  const values = source.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const latest = source.at(-1);
  const domainPadding = Math.max((max - min) * 0.08, Math.abs(max || 1) * 0.01);
  const rainfall = series.code.trim().toLowerCase() === "rain";
  const windDirection = isWindDirection(series);
  const windSpeedWithDirection = isWindSpeed(series) && Boolean(windDirectionSeries);
  return (
    <section className={`telemetry-chart chart-color-${colorIndex % 5}`}>
      <header>
        <div>
          <div className="cell-title">{series.name}</div>
          <div className="chart-meta-row">
            <div className="cell-sub mono">
              {series.code} · {t("platform:telemetry.quantity")} {series.source_count || source.length}
              {series.sampled ? ` · ${source.length} ${t("platform:telemetry.chartPoints")}` : ""}
            </div>
            <div className="chart-stats">
              <span>
                {t("platform:telemetry.minimum")} <strong>{formatNumber(min, { maximumFractionDigits: 2 })}</strong>
              </span>
              <span>
                {t("platform:telemetry.maximum")} <strong>{formatNumber(max, { maximumFractionDigits: 2 })}</strong>
              </span>
            </div>
          </div>
        </div>
        <div className="chart-heading-actions">
        <div className="chart-latest">
          <small>{t("platform:telemetry.latest")}</small>
          <div>
            <strong>{latest ? formatNumber(latest.value, { maximumFractionDigits: 2 }) : "—"}</strong>
            <span>{series.unit}</span>
          </div>
        </div>
        {!expanded && <IconButton label={t("platform:telemetry.expand")} onClick={(event) => { expandButton.current = event.currentTarget; setOpen(true); }}><Maximize2 size={16} /></IconButton>}
        </div>
      </header>
      {!open && <div
        className="chart-canvas"
        role="img"
        aria-label={t("platform:telemetry.trend", { name: series.name })}
        {...(zoomable ? zoom.interactionProps : {})}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 8, bottom: 2, left: 12 }}
          >
            <defs>
              <linearGradient
                id={fillId}
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
              domain={zoomable ? zoom.domain : [Date.parse(startTime), Date.parse(endTime)]}
              allowDataOverflow={zoomable}
              tickFormatter={(value) =>
                formatDateTime(new Date(value), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
              }
              minTickGap={48}
              tick={{ fontSize: 13 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              domain={windDirection ? [0, 360] : rainfall ? [0, max + domainPadding] : [min - domainPadding, max + domainPadding]}
              ticks={windDirection ? [0, 45, 90, 135, 180, 225, 270, 315, 360] : undefined}
              tickFormatter={(value) => windDirection ? windDirectionLabel(Number(value)) : formatNumber(value, { maximumFractionDigits: 2 })}
              width="auto"
              tickMargin={10}
              tick={{ fontSize: 13 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              active={zoom.isDragging ? false : undefined}
              cursor={{
                stroke: "var(--chart)",
                strokeOpacity: 0.45,
                strokeDasharray: "3 3",
              }}
              labelFormatter={(value) =>
                formatDateTime(new Date(Number(value)), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
              }
              formatter={(value, _name, item) => [
                windDirection
                  ? `${formatNumber(Number(value), { maximumFractionDigits: 2 })}° · ${windDirectionLabel(Number(value))}`
                  : `${formatNumber(Number(value), { maximumFractionDigits: 2 })}${series.unit ? ` ${series.unit}` : ""}${windSpeedWithDirection && Number.isFinite(item.payload.windDirection) ? ` · 风向 ${formatNumber(item.payload.windDirection, { maximumFractionDigits: 1 })}° ${windDirectionLabel(item.payload.windDirection)}` : ""}`,
                series.name,
              ]}
              contentStyle={{
                border: "1px solid var(--line)",
                borderRadius: 6,
                boxShadow: "0 8px 24px rgba(24,49,73,.12)",
              }}
            />
            {windDirection ? (
              <Scatter dataKey="value" fill="var(--chart)" isAnimationActive={false}/>
            ) : rainfall ? (
              <Bar
                dataKey="value"
                fill="var(--chart)"
                maxBarSize={18}
                isAnimationActive={false}
              />
            ) : (
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--chart)"
                strokeWidth={2}
                fill={`url(#${fillId})`}
                dot={
                  windSpeedWithDirection
                    ? (props) => <WindArrow {...props as WindArrowProps} />
                    : data.length <= 48
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
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>}
      <div className="chart-legend">
        <span>
          <i className="legend-line" />
          {t("platform:telemetry.realtime")}
        </span>
      </div>
      {series.warnings?.length ? (
        <div className="chart-warning">
          {series.warnings.map((warning) => warning.message).join("；")}
        </div>
      ) : null}
      {!expanded && <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="telemetry-expanded-dialog" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); expandButton.current?.focus(); }}>
          <DialogHeader><DialogTitle>{series.name} · {t("platform:telemetry.expand")}</DialogTitle></DialogHeader>
          {open && <TelemetryChart series={series} colorIndex={colorIndex} windDirectionSeries={windDirectionSeries} startTime={startTime} endTime={endTime} zoomable expanded />}
        </DialogContent>
      </Dialog>}
    </section>
  );
}
