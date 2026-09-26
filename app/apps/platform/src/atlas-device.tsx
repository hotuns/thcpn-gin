import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Search,
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
  api,
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
} from "./platform-ui";
import { AtlasMedia } from "./atlas-media";
import {
  numberLabel,
  seriesSummary,
  streamCatalog,
  timeRange,
  validRange,
  type AtlasConfig,
} from "./atlas-model";

export function AtlasDevice({
  device,
  workspaceId,
  config,
  onSelection,
  initialTab = "metrics",
}: {
  device: DeviceMapItem;
  workspaceId: string;
  config: AtlasConfig;
  onSelection: (ids: string[]) => void;
  initialTab?: "metrics" | "images";
}) {
  const { t, locale } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const [tab, setTab] = useState<string>(
    config.show_images === false ? "metrics" : initialTab,
  );
  const [nodeKey, setNodeKey] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [chartPage, setChartPage] = useState(0);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [range, setRange] = useState(() => timeRange(config.trend_hours ?? 24));
  const [draft, setDraft] = useState(range);
  const [rangeError, setRangeError] = useState(false);
  const streams = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "atlas",
      device.device_id,
      "streams",
    ),
    queryFn: () => api.dataStreams.list(device.device_id),
    staleTime: 60000,
  });
  const isGateway =
    device.device_type === "gateway" || device.device_type.includes("gateway");
  const nodes = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "atlas",
      device.device_id,
      "nodes",
    ),
    queryFn: () => api.devices.nodes(device.device_id),
    enabled: isGateway,
    staleTime: 60000,
  });
  const catalog = useMemo(
    () => streamCatalog(streams.data?.items ?? [], nodes.data?.items ?? []),
    [streams.data, nodes.data],
  );
  const node = nodes.data?.items.find((n) => n.key === nodeKey);
  const metrics = catalog.filter(
    (s) =>
      s.type === "telemetry" &&
      (!node || node.streams.some((n) => n.id === s.id)),
  );
  const matches = metrics.filter((s) =>
    `${s.name} ${s.code} ${s.node}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const selected = (
    chosen ??
    (config.telemetry_stream_ids?.filter((id) =>
      metrics.some((s) => s.id === id),
    ).length
      ? config.telemetry_stream_ids
      : metrics.slice(0, 2).map((s) => s.id)) ??
    []
  ).filter((id) => metrics.some((s) => s.id === id));
  const visible = matches.slice(page * 8, page * 8 + 8);
  // Query only the visible cards and chart page, not every selected stream.
  const currentChartPage = Math.min(
    chartPage,
    Math.max(0, Math.ceil(selected.length / 4) - 1),
  );
  const chartIds =
    config.show_trends === false
      ? []
      : selected.slice(currentChartPage * 4, currentChartPage * 4 + 4);
  const queryStreams = catalog.filter((s) =>
    [...visible.map((s) => s.id), ...chartIds].includes(s.id),
  );
  const queries = useQueries({
    queries: queryStreams.map((stream) => ({
      queryKey: workspaceQueryKey(
        workspaceId,
        "atlas",
        "telemetry",
        stream.id,
        range.start,
        range.end,
      ),
      queryFn: () =>
        api.telemetry.dataStream(stream.id, {
          startTime: range.start,
          endTime: range.end,
          adaptive: true,
          targetPoints: 300,
          limit: 5000,
        }),
      enabled: tab === "metrics",
      staleTime: 60000,
      retry: false,
    })),
  });
  const results = new Map(
    queryStreams.map((stream, index) => [stream.id, queries[index]]),
  );
  useEffect(() => {
    onSelection(selected);
  }, [selected.join(",")]);
  const setHours = (hours: number) => {
    const next = timeRange(hours);
    setRange(next);
    setDraft(next);
    setRangeError(false);
  };
  const changeMetric = (id: string) =>
    setChosen(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  const dateLabel = (value?: string) =>
    value
      ? new Date(value).toLocaleString(locale, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  const imageDevice =
    node?.target.kind === "device" ? node.target.device_id : device.device_id;
  return (
    <section className="atlas-detail">
      <header className="atlas-detail-heading">
        <div>
          <span className="atlas-overline">{a("explore")}</span>
          <h2>{device.name}</h2>
          <p>
            {device.serial_no} <span>·</span>{" "}
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
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="metrics">
              {a("metrics")}{" "}
              <small>
                {catalog.filter((s) => s.type === "telemetry").length}
              </small>
            </TabsTrigger>
            {config.show_images !== false && (
              <>
                <TabsTrigger value="images">{a("images")}</TabsTrigger>
                <TabsTrigger value="photos">{a("photos")}</TabsTrigger>
              </>
            )}
          </TabsList>
        </Tabs>
        {nodes.data?.items.length ? (
          <SelectInput
            aria-label={a("node")}
            value={nodeKey}
            onChange={(e) => {
              setNodeKey(e.target.value);
              setPage(0);
              setChosen(null);
            }}
          >
            <option value="all">{a("all")}</option>
            {nodes.data.items.map((n) => (
              <option key={n.key} value={n.key}>
                {n.name}
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
      {tab !== "photos" && (
        <div className="atlas-range">
          <div className="atlas-presets">
            {[24, 168, 720].map((h, i) => (
              <Button variant="ghost" key={h} onClick={() => setHours(h)}>
                {a(["day", "week", "month"][i])}
              </Button>
            ))}
          </div>
          <div className="atlas-range-inputs">
            <label>
              <span>{a("start")}</span>
              <Input
                aria-label={a("start")}
                type="datetime-local"
                value={localTime(draft.start)}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
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
        </div>
      )}
      {tab === "metrics" ? (
        <>
          <div className="atlas-metric-toolbar">
            <span>
              <Database size={14} />
              {a("streams")} <b>{metrics.length}</b>
            </span>
            <div className="atlas-search">
              <Search size={14} />
              <Input
                aria-label={a("searchMetric")}
                placeholder={a("searchMetric")}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>
          {streams.isLoading ? (
            <AtlasEmpty text={a("loading")} />
          ) : streams.error ? (
            <AtlasError
              error={streams.error}
              retry={() => void streams.refetch()}
            />
          ) : !matches.length ? (
            <AtlasEmpty text={a("noMetrics")} />
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
                    className={`atlas-metric ${selected.includes(stream.id) ? "is-selected" : ""}`}
                    onClick={() => changeMetric(stream.id)}
                    aria-pressed={selected.includes(stream.id)}
                  >
                    <span className="atlas-metric-name">
                      <span title={stream.name}>{stream.name}</span>
                      <span className="atlas-check">
                        {selected.includes(stream.id) && <Check size={11} />}
                      </span>
                    </span>
                    <span className="atlas-metric-value">
                      {query?.isLoading
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
          {matches.length > 8 && (
            <div className="atlas-pagination">
              <Button
                variant="ghost"
                aria-label={a("previous")}
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={14} />
              </Button>
              <span>
                {page + 1} / {Math.ceil(matches.length / 8)}
              </span>
              <Button
                variant="ghost"
                aria-label={a("next")}
                disabled={(page + 1) * 8 >= matches.length}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={14} />
              </Button>
            </div>
          )}
          <div className="atlas-selection">
            <span>{t("atlas.selected", { count: selected.length })}</span>
            <Button variant="ghost" onClick={() => setChosen([])}>
              {a("clear")}
            </Button>
          </div>
          {config.show_trends !== false && (
            <>
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
                      loading={q?.isLoading}
                      retry={() => void q?.refetch()}
                      range={range}
                    />
                  );
                })}
              </div>
              {selected.length > 4 && (
                <nav className="atlas-pagination" aria-label={a("chart")}>
                  <Button
                    variant="ghost"
                    disabled={!currentChartPage}
                    onClick={() => setChartPage(currentChartPage - 1)}
                  >
                    {a("previous")}
                  </Button>
                  <span>
                    {currentChartPage + 1} / {Math.ceil(selected.length / 4)}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={(currentChartPage + 1) * 4 >= selected.length}
                    onClick={() => setChartPage(currentChartPage + 1)}
                  >
                    {a("next")}
                  </Button>
                </nav>
              )}
            </>
          )}
        </>
      ) : (
        <AtlasMedia
          key={`${tab}:${imageDevice}`}
          workspaceId={workspaceId}
          deviceId={tab === "photos" ? device.device_id : imageDevice}
          streams={catalog.filter(
            (s) => s.type === "image" && s.device_id === imageDevice,
          )}
          range={range}
          asset={tab === "photos"}
        />
      )}
    </section>
  );
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
        <AtlasEmpty text={a("loading")} />
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
                  margin={{ top: 12, right: 14, bottom: 0, left: 0 }}
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
                    tick={{ fill: "#8ba6b7", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    width={50}
                    domain={["auto", "auto"]}
                    tick={{ fill: "#8ba6b7", fontSize: 10 }}
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
          <p className="atlas-footnote">{a("sampled")}</p>
        </>
      )}
    </article>
  );
}
