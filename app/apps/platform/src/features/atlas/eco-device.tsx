import { useMemo, useState, type CSSProperties } from "react";
import { Activity, ChevronDown, LineChart, Pin } from "lucide-react";
import { formatApiError, isMeasurement, type DataStream, type TelemetryPoint } from "@thcpn/api";
import { AnimatedNumber } from "./eco-animated-number";
import { ATLAS_METRIC_LIMIT } from "./atlas-metric-preferences";
import { seriesSummary } from "./atlas-model";
import { EcoTrendViewer } from "./eco-trend-viewer";
import { useAtlasDevice, type AtlasDeviceOptions } from "./use-atlas-device";
import { SlidingTabs } from "./atlas-sliding-tabs";
import { ecoMetricColor } from "./eco-palette";
import "./eco-device.css";

const TIME_RANGES = [
  { value: "24", label: "24小时" },
  { value: "168", label: "7天" },
  { value: "720", label: "30天" },
] as const;

type InspectorTab = "readings" | "trends";

export function EcoDeviceInspector(
  props: AtlasDeviceOptions & { motionEnabled?: boolean; revealed?: boolean },
) {
  const { device, config, onNodeChange } = props;
  const model = useAtlasDevice(props);
  const { nodeKey, nodes, metrics, selected, visible, results, range, streams, isGateway } = model;
  const [viewTab, setViewTab] = useState<InspectorTab>("readings");
  const [measurementOpen, setMeasurementOpen] = useState(true);
  const [statusOpen, setStatusOpen] = useState(true);

  const showTrends = config.show_trends !== false;
  const activeTab: InspectorTab = showTrends ? viewTab : "readings";
  const focusedMetricId = metrics.some((stream) => stream.id === model.focusedChart)
    ? model.focusedChart
    : visible[0]?.id ?? metrics[0]?.id ?? null;

  const measurementMetrics = useMemo(() => metrics.filter(isMeasurement), [metrics]);
  const statusMetrics = useMemo(() => metrics.filter((stream) => !isMeasurement(stream)), [metrics]);

  const openTrendFor = (streamId: string) => {
    model.setFocusedChart(streamId);
    if (showTrends) setViewTab("trends");
  };

  return (
    <section
      className="eco-inspector eco-device-inspector t-panel-slide"
      data-open={(props.revealed ?? true) || !props.motionEnabled}
      data-inspector-tab={activeTab}
    >
      <div className="obs-inspector-top">
        <div className="obs-section-head">
          <h2 className="eco-panel-title eco-section-heading">设备采集数据</h2>
        </div>

        <div className="eco-device-toolbar">
          <div className="eco-device-identity" title={device.name}>
            <span className="obs-identity-name">{device.name}</span>
            {isGateway && (
              <>
                <span className="obs-identity-sep">/</span>
                <select
                  aria-label="选择节点"
                  value={nodeKey}
                  onChange={(event) => {
                    model.setNodeKey(event.target.value);
                    model.setChosen(null);
                    onNodeChange?.(event.target.value);
                  }}
                >
                  <option value="gateway">网关概况</option>
                  {nodes.data?.items.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          <SlidingTabs
            className="eco-time-pills"
            ariaLabel="时间范围"
            motionEnabled={props.motionEnabled}
            value={String(model.hours)}
            onChange={(value) => model.setHours(Number(value))}
            items={TIME_RANGES.map((item) => ({ value: item.value, label: item.label }))}
          />
        </div>

        {showTrends && (
          <SlidingTabs
            className="obs-inspector-tabs"
            ariaLabel="观测视图切换"
            motionEnabled={props.motionEnabled}
            value={activeTab}
            onChange={setViewTab}
            items={[
              {
                value: "readings",
                label: (
                  <>
                    <Activity size={13} aria-hidden="true" />
                    <span>读数</span>
                    <em className="obs-tab-count">{metrics.length}</em>
                  </>
                ),
              },
              {
                value: "trends",
                label: (
                  <>
                    <LineChart size={13} aria-hidden="true" />
                    <span>趋势</span>
                    {model.compareIds.length > 0 && (
                      <em className="obs-tab-count">+{model.compareIds.length}</em>
                    )}
                  </>
                ),
              },
            ]}
          />
        )}
      </div>

      {/* Body switches cleanly between Readings (spotlight + full grouped list) and full-height Trends */}
      <div className={`obs-inspector-body${activeTab === "trends" ? " is-trends" : ""}`}>
        {streams.error || nodes.error ? (
          <div className="eco-data-state" role="alert">
            {formatApiError(streams.error ?? nodes.error).message}
          </div>
        ) : streams.isLoading || (nodeKey !== "gateway" && nodes.isLoading) ? (
          <div className="eco-data-state" role="status">
            正在加载…
          </div>
        ) : !metrics.length ? (
          <div className="eco-data-state">暂无采集指标</div>
        ) : activeTab === "readings" ? (
          <>
            {/* Top Pinned Spotlight Cards */}
            {visible.length > 0 && (
              <div className="eco-observation-list" aria-label="关注指标">
                {visible.map((stream, index) => {
                  const result = results.get(stream.id);
                  const summary = seriesSummary(
                    result?.data?.series.find((series) => series.data_stream_id === stream.id),
                  );
                  const active = focusedMetricId === stream.id;
                  const accent = ecoMetricColor(stream.unit);
                  return (
                    <button
                      type="button"
                      key={stream.id}
                      className="eco-observation-row"
                      aria-pressed={active}
                      style={
                        {
                          "--metric-accent": accent,
                          animationDelay: `${index * 30}ms`,
                        } as CSSProperties
                      }
                      onClick={() => openTrendFor(stream.id)}
                    >
                      <span className="eco-observation-name">
                        <i className="obs-metric-dot" aria-hidden="true" />
                        <span>{stream.name}</span>
                      </span>
                      <strong className="eco-observation-value">
                        {result?.isFetching && !summary.latest ? (
                          "…"
                        ) : (
                          <AnimatedNumber
                            value={summary.latest?.value}
                            enabled={props.motionEnabled ?? false}
                          />
                        )}
                        <small>{stream.unit}</small>
                      </strong>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Full Compact Grouped Metric List with Sparklines & Inline Pin */}
            <div className="obs-metric-groups" aria-label="全部指标列表">
              {measurementMetrics.length > 0 && (
                <MetricGroup
                  title="观测指标"
                  streams={measurementMetrics}
                  open={measurementOpen}
                  onToggle={() => setMeasurementOpen((v) => !v)}
                  selectedIds={selected}
                  focusedId={focusedMetricId}
                  results={results}
                  motionEnabled={props.motionEnabled ?? false}
                  onInspect={openTrendFor}
                  onTogglePin={model.togglePin}
                />
              )}
              {statusMetrics.length > 0 && (
                <MetricGroup
                  title="设备状态"
                  streams={statusMetrics}
                  open={statusOpen}
                  onToggle={() => setStatusOpen((v) => !v)}
                  selectedIds={selected}
                  focusedId={focusedMetricId}
                  results={results}
                  motionEnabled={props.motionEnabled ?? false}
                  onInspect={openTrendFor}
                  onTogglePin={model.togglePin}
                />
              )}
            </div>
          </>
        ) : (
          <EcoTrendViewer
            fullHeight
            motionEnabled={props.motionEnabled}
            streams={metrics}
            results={results}
            range={range}
            focusedId={focusedMetricId}
            onFocus={model.setFocusedChart}
            compareIds={model.compareIds}
            onToggleCompare={model.toggleCompare}
          />
        )}
      </div>
    </section>
  );
}

function MetricGroup({
  title,
  streams,
  open,
  onToggle,
  selectedIds,
  focusedId,
  results,
  motionEnabled,
  onInspect,
  onTogglePin,
}: {
  title: string;
  streams: DataStream[];
  open: boolean;
  onToggle: () => void;
  selectedIds: string[];
  focusedId: string | null;
  results: ReturnType<typeof useAtlasDevice>["results"];
  motionEnabled: boolean;
  onInspect: (id: string) => void;
  onTogglePin: (id: string) => boolean;
}) {
  const limitReached = selectedIds.length >= ATLAS_METRIC_LIMIT;

  return (
    <section className="obs-metric-group" data-open={open}>
      <button
        type="button"
        className="obs-metric-group-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>
          {title}
          <small>{streams.length}</small>
        </span>
        <ChevronDown size={14} className="obs-acc-chevron" aria-hidden="true" />
      </button>
      <div className="obs-acc-panel">
        <div className="obs-acc-panel-inner">
          {streams.map((stream) => {
            const result = results.get(stream.id);
            const summary = seriesSummary(
              result?.data?.series.find((series) => series.data_stream_id === stream.id),
            );
            const pinned = selectedIds.includes(stream.id);
            const focused = focusedId === stream.id;
            const color = ecoMetricColor(stream.unit);

            return (
              <div
                key={stream.id}
                className="obs-compact-row"
                data-pinned={pinned}
                data-focused={focused}
                style={{ "--metric-accent": color } as CSSProperties}
              >
                <button
                  type="button"
                  className="obs-compact-main"
                  onClick={() => onInspect(stream.id)}
                  title={`查看「${stream.name}」趋势`}
                >
                  <i className="obs-metric-dot" aria-hidden="true" />
                  <span className="obs-compact-name">{stream.name}</span>
                  <MetricSparkline points={summary.points} color={color} />
                  <span className="obs-compact-value">
                    <strong>
                      {result?.isFetching && !summary.latest ? (
                        "…"
                      ) : (
                        <AnimatedNumber value={summary.latest?.value} enabled={motionEnabled} />
                      )}
                    </strong>
                    <small>{stream.unit}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="obs-pin-btn"
                  aria-pressed={pinned}
                  disabled={!pinned && limitReached}
                  aria-label={pinned ? `取消关注 ${stream.name}` : `关注 ${stream.name}`}
                  title={
                    pinned
                      ? "取消顶部关注"
                      : limitReached
                        ? `最多关注 ${ATLAS_METRIC_LIMIT} 项指标`
                        : "设为顶部关注"
                  }
                  onClick={() => onTogglePin(stream.id)}
                >
                  <Pin size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MetricSparkline({ points, color }: { points: TelemetryPoint[]; color: string }) {
  if (points.length < 2) {
    return <span className="obs-sparkline obs-sparkline-empty" aria-hidden="true" />;
  }
  const maxSamples = 24;
  const sampled =
    points.length <= maxSamples
      ? points
      : Array.from({ length: maxSamples }, (_, idx) => {
          const pos = Math.round((idx / (maxSamples - 1)) * (points.length - 1));
          return points[pos];
        });

  const values = sampled.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const w = 52;
  const h = 18;
  const padY = 2.5;

  const coords = sampled.map((p, idx) => {
    const x = (idx / (sampled.length - 1)) * w;
    const y = span === 0 ? h / 2 : h - padY - ((p.value - min) / span) * (h - padY * 2);
    return [x, y] as const;
  });

  const polyline = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg className="obs-sparkline" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.85"
        points={polyline}
      />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill={color} />
    </svg>
  );
}
