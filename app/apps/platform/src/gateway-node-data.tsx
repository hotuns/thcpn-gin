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
import { Search } from "lucide-react";
import {
  api,
  formatApiError,
  type DataStream,
  type Device,
  type TelemetrySeries,
} from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";
import { DataQuickNavigator, scrollToDataSection } from "./data-quick-navigator";

const colors = [
  "#1769e0",
  "#16845b",
  "#d36b12",
  "#b13e4a",
  "#6a5ab5",
  "#00859a",
  "#b28400",
  "#cf4d8b",
  "#526d82",
  "#5f8f3a",
  "#8e5b3f",
  "#3d68b2",
];
const localTime = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
const metricKey = (stream: DataStream) =>
  `${stream.code}\u0000${stream.unit ?? ""}`;
type Metric = {
  key: string;
  code: string;
  name: string;
  unit: string;
  nodeCount: number;
};
type NodeSeries = { device: Device; series: TelemetrySeries };

export function GatewayNodeData({
  gateway,
  workspaceId,
}: {
  gateway: Device;
  workspaceId: string;
}) {
  const children = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "device",
      gateway.id,
      "children",
      "gateway-data",
    ),
    queryFn: () => api.devices.children(gateway.id),
  });
  const nodes = children.data?.items.map((item) => item.device) ?? [];
  const streamQueries = useQueries({
    queries: nodes.map((node) => ({
      queryKey: workspaceQueryKey(
        workspaceId,
        "device",
        node.id,
        "streams",
        "gateway-data",
      ),
      queryFn: () => api.dataStreams.list(node.id),
      staleTime: 60_000,
    })),
  });
  const streamsByNode = useMemo(
    () =>
      new Map(
        nodes.map((node, index) => [
          node.id,
          (streamQueries[index]?.data?.items ?? []).filter(
            (stream) =>
              stream.type === "telemetry" && stream.status === "active",
          ),
        ]),
      ),
    [nodes, streamQueries],
  );
  const metrics = useMemo(() => metricOptions(streamsByNode), [streamsByNode]);
  const [selected, setSelected] = useState("");
  const [start, setStart] = useState(() =>
    localTime(new Date(Date.now() - 7 * 86_400_000)),
  );
  const [end, setEnd] = useState(() => localTime(new Date()));
  const [applied, setApplied] = useState({ metric: "", start, end });

  useEffect(() => {
    if (!metrics.length) return;
    setSelected((current) =>
      metrics.some((item) => item.key === current) ? current : metrics[0].key,
    );
    setApplied((current) =>
      metrics.some((item) => item.key === current.metric)
        ? current
        : { ...current, metric: metrics[0].key },
    );
  }, [metrics]);

  const selectedStreams = nodes.flatMap((device) => {
    const stream = streamsByNode
      .get(device.id)
      ?.find((item) => metricKey(item) === applied.metric);
    return stream ? [{ device, stream }] : [];
  });
  const telemetry = useQueries({
    queries: selectedStreams.map(({ device, stream }) => ({
      queryKey: workspaceQueryKey(
        workspaceId,
        "gateway",
        gateway.id,
        "node",
        device.id,
        "telemetry",
        stream.id,
        applied.start,
        applied.end,
      ),
      queryFn: () =>
        api.telemetry.dataStream(stream.id, {
          startTime: new Date(applied.start).toISOString(),
          endTime: new Date(applied.end).toISOString(),
          limit: 5000,
          adaptive: true,
          targetPoints: Math.min(
            500,
            Math.max(
              200,
              Math.floor(6000 / Math.max(1, selectedStreams.length)),
            ),
          ),
        }),
      enabled: Boolean(applied.metric && applied.start && applied.end),
    })),
  });
  const series = selectedStreams.flatMap(({ device }, index): NodeSeries[] => {
    const item = telemetry[index]?.data?.series[0];
    return item ? [{ device, series: item }] : [];
  });
  const streamsLoading =
    children.isLoading || streamQueries.some((query) => query.isLoading);
  const streamsError =
    children.error ?? streamQueries.find((query) => query.error)?.error;
  const telemetryLoading = telemetry.some(
    (query) => query.isLoading || query.isFetching,
  );
  const telemetryError = telemetry.find((query) => query.error)?.error;
  const invalid = !start || !end || Date.parse(start) >= Date.parse(end);
  const dirty =
    selected !== applied.metric ||
    start !== applied.start ||
    end !== applied.end;
  const activeMetric = metrics.find((item) => item.key === applied.metric);
  const preset = (hours: number) => {
    const nextEnd = new Date();
    setEnd(localTime(nextEnd));
    setStart(localTime(new Date(nextEnd.getTime() - hours * 3_600_000)));
  };
  const search = () => {
    setApplied({ metric: selected, start, end });
    window.requestAnimationFrame(() =>
      scrollToDataSection("gateway-node-results"),
    );
  };

  return (
    <div className="device-data-layout">
      <div className="device-data-content gateway-node-data">
        <div id="gateway-node-query" className="data-page-anchor">
          <Panel className="gateway-node-query">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">节点数据查询</h2>
                <div className="panel-kicker">
                  同一指标、同一时间范围，对比当前网关下全部节点
                </div>
              </div>
              <div className="header-actions">
                {dirty && <Badge tone="warning">条件未应用</Badge>}
                <Button
                  disabled={invalid || !selected || telemetryLoading}
                  onClick={search}
                >
                  <Search size={14} />
                  {telemetryLoading ? "搜索中…" : "搜索"}
                </Button>
              </div>
            </div>
            <div className="gateway-node-query-fields">
          <label className="field">
            <span className="field-label">开始时间</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">结束时间</span>
            <input
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">对比指标</span>
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={!metrics.length}
            >
              {metrics.map((metric) => (
                <option key={metric.key} value={metric.key}>
                  {metric.name} · {metric.code}
                  {metric.unit ? `（${metric.unit}）` : ""} · {metric.nodeCount}{" "}
                  个节点
                </option>
              ))}
            </select>
          </label>
            </div>
            <div className="range-presets">
          <span>快捷范围</span>
          {[
            { label: "6 小时", hours: 6 },
            { label: "3 天", hours: 72 },
            { label: "7 天", hours: 168 },
          ].map((item) => (
            <button
              key={item.hours}
              type="button"
              onClick={() => preset(item.hours)}
            >
              {item.label}
            </button>
          ))}
            </div>
            {invalid && (
              <div className="form-error query-condition-error">
                结束时间必须晚于开始时间。
              </div>
            )}
          </Panel>
        </div>
        <div
          id="gateway-node-results"
          className="data-page-anchor section-gap"
        >
          <Panel className="gateway-node-chart-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">全部节点趋势对比</h2>
            <div className="panel-kicker">
              {activeMetric
                ? `${activeMetric.name}${activeMetric.unit ? ` · ${activeMetric.unit}` : ""}`
                : "等待选择指标"}{" "}
              · 纵轴使用统一真实量程
            </div>
          </div>
          <Badge tone="info">
            {selectedStreams.length} / {nodes.length} 个节点
          </Badge>
        </div>
        {streamsLoading ? (
          <StateView
            type="loading"
            title="正在加载节点指标"
            description="正在读取当前网关下全部节点的数据流。"
          />
        ) : streamsError ? (
          <StateView
            type="error"
            title="节点指标加载失败"
            description={formatApiError(streamsError).message}
            requestId={formatApiError(streamsError).requestId}
          />
        ) : !nodes.length ? (
          <StateView
            type="empty"
            title="暂无下挂节点"
            description="当前网关下没有可查询节点。"
          />
        ) : !metrics.length ? (
          <StateView
            type="empty"
            title="暂无节点指标"
            description="下挂节点还没有已启用的数据指标。"
          />
        ) : telemetryLoading ? (
          <StateView
            type="loading"
            title="正在查询节点数据"
            description={`正在读取 ${selectedStreams.length} 个节点的同一指标。`}
          />
        ) : telemetryError ? (
          <StateView
            type="error"
            title="节点数据查询失败"
            description={formatApiError(telemetryError).message}
            requestId={formatApiError(telemetryError).requestId}
          />
        ) : series.some((item) => item.series.points.length) ? (
          <ComparisonChart
            items={series}
            start={applied.start}
            end={applied.end}
            unit={activeMetric?.unit ?? ""}
          />
        ) : (
          <StateView
            type="empty"
            title="当前范围没有节点数据"
            description="可以调整时间范围或切换对比指标后重新搜索。"
          />
        )}
          </Panel>
        </div>
      </div>
      <DataQuickNavigator
        items={[
          { id: "gateway-node-query", label: "查询条件", level: 0 },
          { id: "gateway-node-results", label: "全部节点趋势", level: 0 },
        ]}
      />
    </div>
  );
}

function metricOptions(streamsByNode: Map<string, DataStream[]>): Metric[] {
  const result = new Map<string, Metric>();
  streamsByNode.forEach((streams) =>
    streams.forEach((stream) => {
      const key = metricKey(stream);
      const current = result.get(key);
      if (current) current.nodeCount += 1;
      else
        result.set(key, {
          key,
          code: stream.code,
          name: stream.name,
          unit: stream.unit ?? "",
          nodeCount: 1,
        });
    }),
  );
  return [...result.values()].sort(
    (left, right) =>
      right.nodeCount - left.nodeCount ||
      left.name.localeCompare(right.name, "zh-CN"),
  );
}

function ComparisonChart({
  items,
  start,
  end,
  unit,
}: {
  items: NodeSeries[];
  start: string;
  end: string;
  unit: string;
}) {
  const data = useMemo(() => {
    const rows = new Map<number, Record<string, number>>();
    items.forEach(({ device, series }) =>
      series.points.forEach((point) => {
        const time = Date.parse(point.ts);
        if (!Number.isFinite(time) || !Number.isFinite(point.value)) return;
        const row = rows.get(time) ?? { time };
        row[device.id] = point.value;
        rows.set(time, row);
      }),
    );
    return [...rows.values()].sort((left, right) => left.time - right.time);
  }, [items]);
  const date = (value: number) =>
    new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  return (
    <div className="gateway-node-chart-wrap">
      <div className="gateway-node-chart-legend">
        {items.map(({ device, series }, index) => (
          <span key={device.id}>
            <i style={{ background: colors[index % colors.length] }} />
            <strong>{device.name}</strong>
            <small>{series.points.length} 点</small>
          </span>
        ))}
      </div>
      <div
        className="gateway-node-chart"
        role="img"
        aria-label="网关全部节点趋势对比图"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 16, right: 18, bottom: 4, left: 4 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--soft-line)"
              strokeDasharray="3 4"
            />
            <XAxis
              type="number"
              dataKey="time"
              domain={[Date.parse(start), Date.parse(end)]}
              tickFormatter={date}
              minTickGap={54}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              width={58}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) =>
                Number(value).toLocaleString(
                  document.documentElement.lang || "zh-CN",
                  { maximumFractionDigits: 2 },
                )
              }
            />
            <Tooltip
              labelFormatter={(value) => date(Number(value))}
              formatter={(value, name) => [
                `${Number(value).toLocaleString(document.documentElement.lang || "zh-CN", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`,
                items.find((item) => item.device.id === name)?.device.name ??
                  String(name),
              ]}
            />
            {items.map(({ device }, index) => (
              <Line
                key={device.id}
                type="monotone"
                dataKey={device.id}
                name={device.id}
                stroke={colors[index % colors.length]}
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
    </div>
  );
}
