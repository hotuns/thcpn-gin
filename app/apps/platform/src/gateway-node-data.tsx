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
import { GripVertical, Search } from "lucide-react";
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
import { useChartZoom } from "./chart-zoom";
import { TelemetryCharts } from "./telemetry-charts";

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
const metricOrderStorageKey = (nodeId: string) =>
  `ecocloud:gateway-node-data-stream-order:${nodeId}`;
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
  const lorawan = gateway.product_id === "lorawan_v2_gateway";
  const children = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "device",
      gateway.id,
      "children",
      "gateway-data",
    ),
    queryFn: () => api.devices.children(gateway.id),
    enabled: !lorawan,
  });
  const gatewayStreams = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "device",
      gateway.id,
      "streams",
      "gateway-data",
    ),
    queryFn: () => api.dataStreams.list(gateway.id),
    enabled: lorawan,
    staleTime: 60_000,
  });
  const lorawanNodeStreams = useMemo(() => {
    const result = new Map<number, DataStream[]>();
    for (const stream of gatewayStreams.data?.items ?? []) {
      const match = /^lora_node_(\d+)_/.exec(stream.code);
      if (!match || stream.type !== "telemetry" || stream.status !== "active") continue;
      const index = Number(match[1]);
      result.set(index, [
        ...(result.get(index) ?? []),
        {
          ...stream,
          code: stream.code.replace(/^lora_node_\d+_/, ""),
          name: stream.name.replace(/^节点 \d+ · /, ""),
        },
      ]);
    }
    return result;
  }, [gatewayStreams.data?.items]);
  const nodes = lorawan
    ? [...lorawanNodeStreams.keys()].sort((left, right) => left - right).map(
        (index): Device => ({
          ...gateway,
          id: `${gateway.id}:node:${index}`,
          name: `节点 ${index}`,
          serial_no: `${gateway.serial_no}-${index}`,
          device_type: "gateway_node",
          topology_role: "gateway_node",
          child_count: 0,
        }),
      )
    : children.data?.items.map((item) => item.device) ?? [];
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
      enabled: !lorawan,
      staleTime: 60_000,
    })),
  });
  const streamsByNode = useMemo(
    () =>
      new Map(
        nodes.map((node, index) => [
          node.id,
          lorawan
            ? lorawanNodeStreams.get(Number(node.id.split(":").at(-1))) ?? []
            : (streamQueries[index]?.data?.items ?? []).filter(
                (stream) =>
                  stream.type === "telemetry" && stream.status === "active",
              ),
        ]),
      ),
    [lorawan, lorawanNodeStreams, nodes, streamQueries],
  );
  const [selectedNode, setSelectedNode] = useState("");
  const metricStreams = useMemo(
    () => lorawan && selectedNode
      ? new Map([[selectedNode, streamsByNode.get(selectedNode) ?? []]])
      : streamsByNode,
    [lorawan, selectedNode, streamsByNode],
  );
  const metrics = useMemo(() => metricOptions(metricStreams), [metricStreams]);
  const metricSignature = metrics.map((item) => item.key).join("\u0001");
  const [selected, setSelected] = useState("");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [draggedMetric, setDraggedMetric] = useState("");
  const [start, setStart] = useState(() =>
    localTime(new Date(Date.now() - 7 * 86_400_000)),
  );
  const [end, setEnd] = useState(() => localTime(new Date()));
  const [applied, setApplied] = useState({
    node: "",
    metric: "",
    metrics: [] as string[],
    start,
    end,
  });

  useEffect(() => {
    if (!lorawan || !nodes.length) return;
    setSelectedNode((current) =>
      nodes.some((node) => node.id === current) ? current : nodes[0].id,
    );
  }, [lorawan, nodes]);

  useEffect(() => {
    if (!metrics.length) return;
    const availableKeys = metrics.map((item) => item.key);
    let savedKeys: string[] = [];
    if (lorawan) {
      try {
        const value = JSON.parse(
          localStorage.getItem(metricOrderStorageKey(selectedNode)) ?? "[]",
        );
        if (Array.isArray(value)) {
          savedKeys = value.filter(
            (key): key is string =>
              typeof key === "string" && availableKeys.includes(key),
          );
        }
      } catch {
        savedKeys = [];
      }
    }
    const metricKeys = [
      ...savedKeys,
      ...availableKeys.filter((key) => !savedKeys.includes(key)),
    ];
    if (lorawan) setSelectedMetrics(metricKeys);
    setSelected((current) =>
      metrics.some((item) => item.key === current) ? current : metrics[0].key,
    );
    setApplied((current) =>
      (lorawan
        ? current.metrics.some((key) => metricKeys.includes(key))
        : metrics.some((item) => item.key === current.metric)) &&
      (!lorawan || nodes.some((node) => node.id === current.node))
        ? current
        : {
            ...current,
            node: lorawan ? selectedNode : current.node,
            metric: metrics[0].key,
            metrics: lorawan ? metricKeys : current.metrics,
          },
    );
  }, [lorawan, metricSignature, selectedNode]);

  const selectedStreams = nodes.filter((device) => !lorawan || device.id === applied.node).flatMap((device) => {
    const streams = streamsByNode.get(device.id) ?? [];
    if (lorawan) {
      return streams
        .filter((item) => applied.metrics.includes(metricKey(item)))
        .sort(
          (left, right) =>
            applied.metrics.indexOf(metricKey(left)) -
            applied.metrics.indexOf(metricKey(right)),
        )
        .map((stream) => ({ device, stream }));
    }
    const stream = streams.find((item) => metricKey(item) === applied.metric);
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
      enabled: Boolean(
        (lorawan ? applied.metrics.length : applied.metric) &&
          applied.start &&
          applied.end,
      ),
    })),
  });
  const series = selectedStreams.flatMap(({ device }, index): NodeSeries[] => {
    const item = telemetry[index]?.data?.series[0];
    return item ? [{ device, series: item }] : [];
  });
  const streamsLoading =
    children.isLoading || gatewayStreams.isLoading || streamQueries.some((query) => query.isLoading);
  const streamsError =
    children.error ?? gatewayStreams.error ?? streamQueries.find((query) => query.error)?.error;
  const telemetryLoading = telemetry.some(
    (query) => query.isLoading || query.isFetching,
  );
  const telemetryError = telemetry.find((query) => query.error)?.error;
  const invalid = !start || !end || Date.parse(start) >= Date.parse(end);
  const dirty =
    (lorawan && selectedNode !== applied.node) ||
    (lorawan
      ? selectedMetrics.join("\u0001") !== applied.metrics.join("\u0001")
      : selected !== applied.metric) ||
    start !== applied.start ||
    end !== applied.end;
  const activeMetric = metrics.find((item) => item.key === applied.metric);
  const orderedMetrics = [
    ...selectedMetrics
      .map((key) => metrics.find((item) => item.key === key))
      .filter((item) => item !== undefined),
    ...metrics.filter((item) => !selectedMetrics.includes(item.key)),
  ];
  const preset = (hours: number) => {
    const nextEnd = new Date();
    setEnd(localTime(nextEnd));
    setStart(localTime(new Date(nextEnd.getTime() - hours * 3_600_000)));
  };
  const search = () => {
    setApplied({ node: selectedNode, metric: selected, metrics: selectedMetrics, start, end });
    window.requestAnimationFrame(() =>
      scrollToDataSection("gateway-node-results"),
    );
  };
  const moveSelectedMetric = (target: string) => {
    if (!draggedMetric || draggedMetric === target) return;
    const from = selectedMetrics.indexOf(draggedMetric);
    const to = selectedMetrics.indexOf(target);
    if (from < 0 || to < 0) return;
    const next = [...selectedMetrics];
    next.splice(to, 0, next.splice(from, 1)[0]);
    localStorage.setItem(metricOrderStorageKey(selectedNode), JSON.stringify(next));
    setSelectedMetrics(next);
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
                  {lorawan ? "选择一个节点和数据指标后查询数据" : "同一指标、同一时间范围，对比当前网关下全部节点"}
                </div>
              </div>
              <div className="header-actions">
                {dirty && <Badge tone="warning">条件未应用</Badge>}
                <Button
                  disabled={invalid || (lorawan ? !selectedNode || !selectedMetrics.length : !selected) || telemetryLoading}
                  onClick={search}
                >
                  <Search size={14} />
                  {telemetryLoading ? "搜索中…" : "搜索"}
                </Button>
              </div>
            </div>
            <div className="gateway-node-query-fields">
          {lorawan && <label className="field">
            <span className="field-label">节点</span>
            <select value={selectedNode} onChange={(event) => setSelectedNode(event.target.value)} disabled={!nodes.length}>
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select>
          </label>}
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
          {!lorawan && <label className="field">
            <span className="field-label">对比指标</span>
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={!metrics.length}
            >
              {metrics.map((metric) => (
                <option key={metric.key} value={metric.key}>
                  {metric.name} · {metric.code}
                  {metric.unit ? `（${metric.unit}）` : ""} · {metric.nodeCount} 个节点
                </option>
              ))}
            </select>
          </label>}
          {lorawan && <fieldset className="gateway-node-metric-field">
            <legend className="field-label">数据指标</legend>
            <div className="gateway-node-metric-heading">
              <small>拖动已选指标可调整下方图表顺序</small>
              <div className="header-actions">
                <Badge tone="info">已选 {selectedMetrics.length}</Badge>
                <Button
                  variant="secondary"
                  disabled={!metrics.length}
                  onClick={() => setSelectedMetrics(
                    selectedMetrics.length === metrics.length
                      ? []
                      : metrics.map((item) => item.key),
                  )}
                >
                  {selectedMetrics.length === metrics.length && selectedMetrics.length ? "清空" : "全选"}
                </Button>
              </div>
            </div>
            <div className="gateway-node-metric-checks">
              {orderedMetrics.map((metric) => (
                <label
                  key={metric.key}
                  className={selectedMetrics.includes(metric.key) ? "selected" : ""}
                  draggable={selectedMetrics.includes(metric.key)}
                  onDragStart={(event) => {
                    if (!selectedMetrics.includes(metric.key)) return;
                    setDraggedMetric(metric.key);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    if (!draggedMetric || !selectedMetrics.includes(metric.key)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveSelectedMetric(metric.key);
                  }}
                  onDragEnd={() => {
                    setDraggedMetric("");
                  }}
                >
                  <GripVertical className="stream-drag-handle" size={13} aria-hidden="true" />
                  <input
                    type="checkbox"
                    checked={selectedMetrics.includes(metric.key)}
                    onChange={(event) => setSelectedMetrics((current) =>
                      event.target.checked
                        ? [...current, metric.key]
                        : current.filter((key) => key !== metric.key),
                    )}
                  />
                  <span>
                    <strong>{metric.name}</strong>
                    <small>{metric.code}{metric.unit ? ` · ${metric.unit}` : ""}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>}
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
            <h2 className="panel-title">{lorawan ? `${nodes.find((node) => node.id === applied.node)?.name ?? "节点"} 数据趋势` : "全部节点趋势对比"}</h2>
            <div className="panel-kicker">
              {lorawan
                ? (applied.metrics.length ? `${applied.metrics.length} 个数据指标` : "等待选择指标")
                : activeMetric
                ? `${activeMetric.name}${activeMetric.unit ? ` · ${activeMetric.unit}` : ""}`
                : "等待选择指标"}{" "}
              {lorawan ? "" : " · 纵轴使用统一真实量程"}
            </div>
          </div>
          <Badge tone="info">{lorawan ? `${nodes.length} 个节点可选` : `${selectedStreams.length} / ${nodes.length} 个节点`}</Badge>
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
            description={lorawan ? "正在读取所选节点的数据。" : `正在读取 ${selectedStreams.length} 个节点的同一指标。`}
          />
        ) : telemetryError ? (
          <StateView
            type="error"
            title="节点数据查询失败"
            description={formatApiError(telemetryError).message}
            requestId={formatApiError(telemetryError).requestId}
          />
        ) : series.some((item) => item.series.points.length) ? lorawan ? (
          <TelemetryCharts
            series={series.map((item) => item.series)}
            startTime={applied.start}
            endTime={applied.end}
          />
        ) : (
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
            description={lorawan ? "可以调整时间范围或切换数据指标后重新搜索。" : "可以调整时间范围或切换对比指标后重新搜索。"}
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
  const zoom = useChartZoom(Date.parse(start), Date.parse(end));
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
        title="滚轮缩放，双击恢复完整范围"
        onWheel={zoom.onWheel}
        onDoubleClick={zoom.resetZoom}
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
              domain={zoom.domain}
              allowDataOverflow
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
