import { useAtlasDevice } from "./use-atlas-device";
import { Popover } from "radix-ui";
import { AtlasMetricSelection } from "./atlas-metric-settings";
import { nodeOptionLabel } from "@thcpn/api";
import { isMeasurement, streamPurposeLabel } from "@thcpn/api";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Check,
  CalendarRange,
  LoaderCircle,
  Database,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatApiError,
  type DataStream,
  type DeviceMapItem,
  type TelemetrySeries,
} from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";
import { workspaceQueryKey } from "@thcpn/workspace";
import {
  Button,
  Input,
  SelectInput,
  Tabs,
  TabsList,
  TabsTrigger,
  Table,
} from "../../shared/ui";
import { AtlasMedia } from "./atlas-media";
import { useSceneReveal } from "../../shared/hooks/use-scene-reveal";
import { ObservationIcon } from "../devices/observation-icon";
import {
  numberLabel,
  seriesSummary,
  validRange,
  type AtlasConfig,
} from "./atlas-model";

export function AtlasDevice({
  device,
  workspaceId,
  config,
  onSelection,
  analysisHost,
  boardId = "default",
  selectedNodeKey,
  onNodeChange,
}: {
  device: DeviceMapItem;
  workspaceId: string;
  config: AtlasConfig;
  boardId?: string;
  selectedNodeKey?: string;
  onNodeChange?: (key: string) => void;
  onSelection: (ids: string[]) => void;
  initialTab?: "metrics" | "images";
  analysisHost?: HTMLElement | null;
}) {
  const { t, locale } = useLocale();
  const revealed = useSceneReveal();
  const a = (key: string) => t(`atlas.${key}`);
  const { tab, setTab, mediaAvailable, setMediaAvailable, nodeKey, setNodeKey, setChosen,
    pickerOpen, setPickerOpen, metricDraft, setMetricDraft, preferenceError, setPreferenceError,
    setFocusedChart, storageKey, range, setRange, draft, setDraft, rangeError, setRangeError,
    streams, isGateway, nodes, catalog, node, metrics, selected, visible, chartIds, results, setHours,
    savePreference, imageDevice } = useAtlasDevice({ device, workspaceId, config, boardId, selectedNodeKey, onNodeChange });
  useEffect(() => {
    onSelection(selected);
  }, [selected.join(",")]);
  const dateLabel = (value?: string) =>
    value
      ? new Date(value).toLocaleString(locale, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  return (
    <section className="atlas-detail">
      <header
        className="atlas-detail-heading t-panel-slide"
        data-open={revealed}
      >
        <div>
          <span className="atlas-overline">{a("explore")}</span>
          <h2>{node?.name ?? device.name}</h2>
          <p>
            {node ? device.name : device.serial_no} <span>·</span>{" "}
            {device.environment.ecosystem?.[
              locale === "en-US" ? "name_en" : "name_zh"
            ] || a("devices")}
          </p>
        </div>
        <Link
          to={`/devices/${device.device_id}?tab=data`}
          aria-label={a("details")}
          className="atlas-icon-link"
        >
          <ArrowUpRight size={19} />
        </Link>
      </header>
      <div className="atlas-detail-controls">
        {nodes.data?.items.length ? (
          <SelectInput
            aria-label={a("node")}
            value={nodeKey}
            onChange={(e) => {
              setNodeKey(e.target.value);
              onNodeChange?.(e.target.value);
              setChosen(null);
            }}
          >
            <option value="gateway">网关概况</option>
            {nodes.data.items.map((n) => (
              <option key={n.key} value={n.key}>
                {nodeOptionLabel(n)}
              </option>
            ))}
          </SelectInput>
        ) : null}
        {nodes.error && (
          <p role="alert" className="atlas-warning">
            {formatApiError(nodes.error).message}
          </p>
        )}
      </div>
      {
        <div className="atlas-range">
          <div className="atlas-presets">
            {[24, 168, 720].map((h, i) => (
              <Button variant="ghost" key={h} onClick={() => setHours(h)}>
                {a(["day", "week", "month"][i])}
              </Button>
            ))}
          </div>
          <details className="atlas-range-editor">
            <summary>
              <CalendarRange size={14} />
              <span>
                {dateLabel(range.start)} — {dateLabel(range.end)}
              </span>
            </summary>
            <div className="atlas-range-inputs">
              <label>
                <span>{a("start")}</span>
                <Input
                  aria-label={a("start")}
                  type="datetime-local"
                  value={localTime(draft.start)}
                  onChange={(e) =>
                    setDraft({ ...draft, start: e.target.value })
                  }
                />
              </label>
              <label>
                <span>{a("end")}</span>
                <Input
                  aria-label={a("end")}
                  type="datetime-local"
                  value={localTime(draft.end)}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                />
              </label>
              <Button
                onClick={() => {
                  if (!validRange(draft.start, draft.end)) {
                    setRangeError(true);
                    return;
                  }
                  setRange({
                    start: new Date(draft.start).toISOString(),
                    end: new Date(draft.end).toISOString(),
                  });
                  setRangeError(false);
                }}
              >
                {a("apply")}
              </Button>
            </div>
            {rangeError && (
              <p role="alert" className="atlas-warning">
                {a("invalidRange")}
              </p>
            )}
          </details>
        </div>
      }
      {
        <>
          <div className="atlas-metric-toolbar">
            <span><Database size={14} />关注指标 <b>{selected.length}</b></span>
            <Popover.Root open={pickerOpen} onOpenChange={open => { setPickerOpen(open); if (open) { setMetricDraft(selected); setPreferenceError(""); } }}>
              <Popover.Trigger asChild><Button variant="ghost">全部指标 · {metrics.length}</Button></Popover.Trigger>
              <Popover.Portal><Popover.Content className="atlas-metric-popover" side="left" align="start" sideOffset={14} collisionPadding={12} aria-label="指标展示设置">
                <header><h3>指标展示设置</h3><Popover.Close asChild><Button variant="ghost" aria-label="关闭指标设置">×</Button></Popover.Close></header>
                <p>个人设置 · 仅对当前设备或节点生效，保存在此浏览器</p>
                <AtlasMetricSelection key={storageKey} metrics={metrics} value={metricDraft} onChange={setMetricDraft} />
                {preferenceError && <p role="alert">{preferenceError}</p>}
                <footer><Button variant="ghost" onClick={() => savePreference(true)}>恢复类型默认</Button><Button onClick={() => savePreference()}>保存</Button></footer>
              </Popover.Content></Popover.Portal>
            </Popover.Root>
          </div>
          {streams.isLoading ? (
            <AtlasEmpty text={a("loading")} />
          ) : streams.error ? (
            <AtlasError
              error={streams.error}
              retry={() => void streams.refetch()}
            />
          ) : !visible.length ? (
            <AtlasEmpty text={metrics.length ? "尚未选择关注指标，请打开全部指标进行配置" : a("noMetrics")} />
          ) : (
            <div className="atlas-metrics">
              {visible.map((stream) => {
                const query = results.get(stream.id);
                const series = query?.data?.series.find(
                  (s) => s.data_stream_id === stream.id,
                );
                const summary = seriesSummary(series);
                const error = query?.error
                  ? formatApiError(query.error).message
                  : series?.error;
                return (
                  <Button
                    variant="ghost"
                    key={stream.id}
                    className={`atlas-metric ${chartIds.includes(stream.id) ? "is-selected" : ""}`}
                    onClick={() => setFocusedChart(stream.id)}
                    aria-pressed={chartIds.includes(stream.id)}
                  >
                    <span className="atlas-metric-name">
                      <ObservationIcon unit={stream.unit} size={15} />
                      <span title={stream.name}>{stream.name}{!isMeasurement(stream) && ` · ${streamPurposeLabel(stream)}`}</span>
                      <span className="atlas-check">
                        {selected.includes(stream.id) && <Check size={11} />}
                      </span>
                    </span>
                    <span className="atlas-metric-value">
                      {query?.isFetching
                        ? "…"
                        : numberLabel(summary.latest?.value)}
                      <small>{stream.unit}</small>
                    </span>
                    <span className="atlas-metric-meta">
                      <span
                        className="atlas-metric-source"
                        title={stream.node || stream.code}
                      >
                        {stream.node || stream.code}
                      </span>
                      <time>
                        {error
                          ? a("failed")
                          : summary.latest
                            ? dateLabel(summary.latest.ts)
                            : a("noData")}
                      </time>
                    </span>
                    {error && <span className="atlas-warning">{error}</span>}
                  </Button>
                );
              })}
            </div>
          )}
          {config.show_trends !== false && (
            <AtlasAnalysis host={analysisHost}>
              <div className="atlas-analysis-title">
                <Activity size={14} />
                {a("chart")}
              </div>
              <div className="atlas-trends">
                {!selected.length && <AtlasEmpty text={a("nothingSelected")} />}{" "}
                {chartIds.map((id) => {
                  const stream = catalog.find((s) => s.id === id)!;
                  const q = results.get(id);
                  return (
                    <AtlasTrend
                      key={id}
                      stream={stream}
                      series={q?.data?.series.find(
                        (s) => s.data_stream_id === id,
                      )}
                      error={q?.error}
                      loading={q?.isFetching}
                      retry={() => void q?.refetch()}
                      range={range}
                    />
                  );
                })}
              </div>
            </AtlasAnalysis>
          )}
        </>
      }
      {config.show_images !== false && (
        <section className="atlas-imagery" hidden={!mediaAvailable}>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="images">{a("images")}</TabsTrigger>
              <TabsTrigger value="photos">{a("photos")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <AtlasMedia
            key={`${tab}:${imageDevice}:${nodeKey}`}
            workspaceId={workspaceId}
            deviceId={tab === "photos" ? device.device_id : imageDevice}
            streams={(node?.streams ?? (isGateway && nodeKey !== "gateway" ? [] : catalog)).filter(
              (s) => s.type === "image" && s.status === "active" && (node || s.device_id === imageDevice),
            )}
            restrictToStreams={node?.target.kind === "gateway_node" || (isGateway && nodeKey !== "gateway" && !node)}
            range={range}
            asset={tab === "photos"}
            pageSize={2}
            onAvailability={setMediaAvailable}
            assetDeviceId={device.device_id}
          />
        </section>
      )}
    </section>
  );
}

// One query/selection owner for both templates; only the chart destination changes.
function AtlasAnalysis({
  host,
  children,
}: {
  host?: HTMLElement | null;
  children: ReactNode;
}) {
  const content = <section className="atlas-analysis">{children}</section>;
  return host ? createPortal(content, host) : content;
}

function localTime(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function AtlasEmpty({ text }: { text: string }) {
  return (
    <div className="atlas-empty">
      <Activity size={25} />
      <p>{text}</p>
    </div>
  );
}
export function AtlasError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="atlas-error" role="alert">
      <p>{formatApiError(error).message}</p>
      <Button variant="secondary" onClick={retry}>
        {t("atlas.retry")}
      </Button>
    </div>
  );
}
function AtlasTrend({
  stream,
  series,
  error,
  loading,
  retry,
  range,
}: {
  stream: DataStream;
  series?: TelemetrySeries;
  error?: unknown;
  loading?: boolean;
  retry: () => void;
  range: { start: string; end: string };
}) {
  const { t, locale } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const [table, setTable] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [range.start, range.end]);
  const summary = useMemo(() => seriesSummary(series), [series]);
  return (
    <article className="atlas-trend">
      <header>
        <h3>
          {stream.name}
          <small>{stream.unit}</small>
        </h3>
        <Button variant="ghost" onClick={() => setTable(!table)}>
          {a(table ? "chart" : "table")}
        </Button>
      </header>
      {loading ? (
        <div className="atlas-empty" role="status" aria-busy="true"><LoaderCircle className="spin" aria-hidden="true"/>{a("loading")}</div>
      ) : error ? (
        <AtlasError error={error} retry={retry} />
      ) : series?.error ? (
        <p role="alert" className="atlas-warning">
          {series.error}
        </p>
      ) : !summary.points.length ? (
        <AtlasEmpty text={a("noData")} />
      ) : (
        <>
          <div className="atlas-stat-row">
            {(["min", "mean", "max"] as const).map((key) => (
              <span key={key}>
                {a(key)} <b>{numberLabel(summary[key])}</b>
              </span>
            ))}
          </div>
          {table ? (
            <div className="atlas-data-table">
              <Table>
                <thead>
                  <tr>
                    <th>{a("time")}</th>
                    <th>{a("value")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.points
                    .slice(page * 20, page * 20 + 20)
                    .map((p, i) => (
                      <tr key={`${p.ts}:${i}`}>
                        <td>{new Date(p.ts).toLocaleString(locale)}</td>
                        <td>
                          {numberLabel(p.value)} {stream.unit}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </Table>
              <div className="atlas-pagination">
                <Button
                  variant="ghost"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  {a("previous")}
                </Button>
                {page + 1}/{Math.ceil(summary.points.length / 20)}
                <Button
                  variant="ghost"
                  disabled={(page + 1) * 20 >= summary.points.length}
                  onClick={() => setPage(page + 1)}
                >
                  {a("next")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="atlas-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={summary.points.map((p) => ({
                    ...p,
                    time: Date.parse(p.ts),
                  }))}
                  margin={{ top: 12, right: 14, bottom: 0, left: 12 }}
                >
                  <defs>
                    <linearGradient
                      id={`atlas-fill-${stream.id}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#54dacb" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#54dacb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="#29404e"
                    strokeDasharray="3 6"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    type="number"
                    domain={[Date.parse(range.start), Date.parse(range.end)]}
                    tickFormatter={(v) =>
                      new Date(v).toLocaleString(locale, {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }
                    tick={{ fill: "#8ba6b7", fontSize: 13 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    width="auto"
                    tickMargin={10}
                    domain={["auto", "auto"]}
                    tick={{ fill: "#8ba6b7", fontSize: 13 }}
                    tickFormatter={numberLabel}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#112331",
                      border: "1px solid #314b5b",
                      borderRadius: 8,
                      color: "#e1edf5",
                    }}
                    labelFormatter={(v) =>
                      new Date(Number(v)).toLocaleString(locale)
                    }
                  />
                  <Area
                    dataKey="value"
                    name={`${stream.name} ${stream.unit ?? ""}`}
                    stroke="#54dacb"
                    strokeWidth={2}
                    fill={`url(#atlas-fill-${stream.id})`}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {!series?.complete && <p className="atlas-warning">{a("partial")}</p>}
          {series?.warnings?.map((w, i) => (
            <p className="atlas-warning" key={i}>
              {w.message}
            </p>
          ))}
        </>
      )}
    </article>
  );
}
