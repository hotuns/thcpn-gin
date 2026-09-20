import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { Search } from "lucide-react";
import { api, formatApiError, type Device, type GatewayNode, type TelemetrySeries } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, CheckboxInput, Panel, SelectInput, StateView, Table } from "./platform-ui";
import { TelemetryCharts } from "./telemetry-charts";
import { DeviceQueryToolbar, initialQueryRange } from "./device-query-toolbar";

export const nodeDeviceId = (node: GatewayNode) => node.target.kind === "device" ? node.target.device_id : node.target.gateway_device_id;
export const nodeMetricKey = (stream: GatewayNode["streams"][number]) => `${stream.code}\u0000${stream.unit ?? ""}`;

export function GatewayNodeData({ gateway, workspaceId }: { gateway: Device; workspaceId: string }) {
  const [params, setParams] = useSearchParams();
  const nodesQuery = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", gateway.id, "nodes"),
    queryFn: () => api.devices.nodes(gateway.id),
  });
  const nodes = nodesQuery.data?.items ?? [];
  const requestedNode = params.get("node") ?? "";
  const selectedNode = nodes.some((node) => node.key === requestedNode) ? requestedNode : nodes[0]?.key ?? "";
  const [mode, setMode] = useState<"node" | "compare">("node");
  const [range, setRange] = useState(initialQueryRange);
  const draggedMetric = useRef<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [applied, setApplied] = useState<{ mode: "node" | "compare"; node: string; metrics: string[]; start: string; end: string } | null>(null);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"chart" | "table">("chart");
  const availableNodes = mode === "node" ? nodes.filter((node) => node.key === selectedNode) : nodes;
  const metrics = useMemo(() => {
    const result = new Map<string, { key: string; name: string; unit: string; count: number }>();
    for (const node of availableNodes) for (const stream of node.streams) {
      const key = nodeMetricKey(stream);
      const existing = result.get(key);
      if (existing) existing.count++;
      else result.set(key, { key, name: stream.name, unit: stream.unit ?? "", count: 1 });
    }
    return [...result.values()];
  }, [availableNodes]);
  const signature = metrics.map((metric) => metric.key).join("\u0001");
  useEffect(() => {
    setSelected(mode === "compare" ? metrics.slice(0, 1).map((metric) => metric.key) : metrics.map((metric) => metric.key));
  }, [gateway.id, selectedNode, mode, signature]);
  useEffect(() => { setApplied(null); }, [gateway.id]);

  const queryGroups = useMemo(() => {
    const groups = new Map<string, { deviceId: string; streams: Array<{ node: GatewayNode; id: string }> }>();
    if (!applied) return [];
    for (const node of nodes) {
      if (applied.mode === "node" && node.key !== applied.node) continue;
      for (const stream of node.streams) {
        if (!applied.metrics.includes(nodeMetricKey(stream))) continue;
        const deviceId = nodeDeviceId(node);
        const group = groups.get(deviceId) ?? { deviceId, streams: [] };
        group.streams.push({ node, id: stream.id });
        groups.set(deviceId, group);
      }
    }
    return [...groups.values()];
  }, [nodes, applied]);
  const queries = useQueries({ queries: queryGroups.map((group) => ({
    queryKey: workspaceQueryKey(workspaceId, "gateway", gateway.id, "telemetry", group.deviceId, group.streams.map((stream) => stream.id).join(","), applied?.start ?? "", applied?.end ?? ""),
    queryFn: () => api.telemetry.device(group.deviceId, {
      startTime: new Date(applied!.start).toISOString(), endTime: new Date(applied!.end).toISOString(),
      dataStreamIds: group.streams.map((stream) => stream.id), limit: 5000, adaptive: true, targetPoints: 500,
    }),
    enabled: Boolean(applied),
  })) });
  const series: TelemetrySeries[] = queries.flatMap((query, index) => (query.data?.series ?? []).map((item) => {
    const node = queryGroups[index].streams.find((stream) => stream.id === item.data_stream_id)?.node;
    return { ...item, name: applied?.mode === "compare" ? `${node?.name ?? "节点"} · ${item.name}` : item.name };
  }));
  const streamOrder = new Map(nodes.flatMap((node) => node.streams.map((stream) => [stream.id, applied?.metrics.indexOf(nodeMetricKey(stream)) ?? 0] as const)));
  series.sort((a,b) => (streamOrder.get(a.data_stream_id) ?? 0) - (streamOrder.get(b.data_stream_id) ?? 0));
  const failures = queries.flatMap((query, index) => query.error ? [{ label: queryGroups[index].streams[0]?.node.name ?? "节点", error: query.error }] : []);
  const loading = queries.some((query) => query.isFetching);
  const invalid = !range.start || !range.end || Date.parse(range.start) >= Date.parse(range.end);
  const dirty = !applied || applied.node !== selectedNode || applied.mode !== mode || applied.metrics.join() !== selected.join() || applied.start !== range.start || applied.end !== range.end;
  const search = () => {
    setPage(0);
    const next = { ...range, node: selectedNode, metrics: [...selected], mode };
    if (!dirty) void Promise.all(queries.map((query) => query.refetch()));
    else setApplied(next);
  };
  const selectNode = (key: string) => setParams((current) => { const next = new URLSearchParams(current); next.set("node", key); return next; }, { replace: true });
  const points = series.flatMap((item) => item.points.map((point) => ({ ...point, stream: item.data_stream_id, name: item.name, unit: item.unit })));

  return <div className="device-data-layout"><div className="device-data-content gateway-node-data">
    <Panel className="gateway-node-query">
      <div className="panel-header"><div><h2 className="panel-title">节点数据查询</h2><div className="panel-kicker">选择节点与指标，查看趋势或对比节点</div></div><div className="header-actions">{dirty && <Badge tone="warning">条件未应用</Badge>}<Button disabled={invalid || !selected.length || loading || !selectedNode} onClick={search}><Search size={14}/>{loading ? "查询中…" : dirty ? "查询" : "刷新"}</Button></div></div>
      {nodesQuery.error && <StateView type="error" title="节点加载失败" description={formatApiError(nodesQuery.error).message} />}
      {nodesQuery.isLoading ? <StateView type="loading" title="正在加载节点" description="正在读取节点与指标。" /> : <>
        <div className="gateway-node-query-fields">
          <label className="field"><span className="field-label">查询方式</span><SelectInput value={mode} onChange={(event) => setMode(event.target.value as "node" | "compare")}><option value="node">节点数据</option><option value="compare">节点对比</option></SelectInput></label>
          {mode === "node" && <label className="field"><span className="field-label">节点</span><SelectInput value={selectedNode} onChange={(event) => selectNode(event.target.value)} disabled={!nodes.length}>{nodes.map((node) => <option key={node.key} value={node.key}>{node.name}</option>)}</SelectInput></label>}
        </div>
        <DeviceQueryToolbar range={range} onChange={setRange}/>
        {mode === "compare" ? <label className="field"><span className="field-label">对比指标</span><SelectInput value={selected[0] ?? ""} onChange={(event) => setSelected([event.target.value])}>{metrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.name}{metric.unit ? ` · ${metric.unit}` : ""} · {metric.count} 个节点</option>)}</SelectInput></label> : <fieldset className="gateway-node-metric-field"><legend className="field-label">指标</legend><div className="gateway-node-metric-checks">{[...metrics].sort((a,b) => (selected.includes(a.key) ? selected.indexOf(a.key) : metrics.length) - (selected.includes(b.key) ? selected.indexOf(b.key) : metrics.length)).map((metric) => <label key={metric.key} draggable={selected.includes(metric.key)} onDragStart={() => { draggedMetric.current = metric.key; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = selected.indexOf(draggedMetric.current ?? ""); const to = selected.indexOf(metric.key); if (from < 0 || to < 0 || from === to) return; const next = [...selected]; next.splice(to, 0, next.splice(from, 1)[0]); setSelected(next); draggedMetric.current = null; }} className={selected.includes(metric.key) ? "selected" : ""}><CheckboxInput checked={selected.includes(metric.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, metric.key] : current.filter((key) => key !== metric.key))}/><span><strong>{metric.name}</strong><small>{metric.unit}</small></span></label>)}</div></fieldset>}
        {!nodes.length && !nodesQuery.error && <StateView type="empty" title="暂无节点" description="当前组网站还没有配置节点。"/>}
        {nodes.length > 0 && !metrics.length && <StateView type="empty" title="暂无指标" description="该节点尚未同步有效的指标配置；节点仍可正常选择。"/>}
      </>}
    </Panel>
    <Panel className="section-gap gateway-node-chart-panel">
      <div className="panel-header"><h2 className="panel-title">{applied?.mode === "compare" ? "节点对比" : "数据结果"}</h2><div className="header-actions"><Link className="button button-secondary" to={`/exports?${new URLSearchParams({system:"group",gateway:gateway.id,nodes:mode === "node" ? selectedNode : nodes.map((node) => node.key).join(","),start:range.start,end:range.end})}`}>导出</Link><Button variant="secondary" onClick={() => setView(view === "chart" ? "table" : "chart")}>{view === "chart" ? "查看表格" : "查看曲线"}</Button></div></div>
      {failures.map((failure) => <div key={failure.label} className="form-error">{failure.label}：{formatApiError(failure.error).message}</div>)}
      {series.filter((item) => item.error).map((item) => <div key={item.data_stream_id} className="form-error">{item.name}：{item.error}</div>)}
      {series.some((item) => !item.complete && !item.error) && <div className="command-note">部分指标数据不完整，请缩小时间范围后重试。</div>}
      {series.flatMap((item) => item.warnings ?? []).map((warning, index) => <div key={index} className="command-note">{warning.message}</div>)}
      {loading && <StateView type="loading" title="正在查询" description="正在读取所选节点的数据。"/>}
      {points.length && applied ? view === "chart" ? <TelemetryCharts series={series} startTime={applied.start} endTime={applied.end} displayMode={applied.mode === "compare" ? "compare" : undefined}/> : <div className="table-wrap"><Table><thead><tr><th>指标</th><th>时间</th><th>数值</th></tr></thead><tbody>{points.slice(page * 100, (page + 1) * 100).map((point, index) => <tr key={`${point.stream}:${index}`}><td>{point.name}</td><td>{new Date(point.ts).toLocaleString()}</td><td>{point.value} {point.unit}</td></tr>)}</tbody></Table><div className="header-actions"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button><span>{page + 1} / {Math.max(1, Math.ceil(points.length / 100))}</span><Button disabled={(page + 1) * 100 >= points.length} onClick={() => setPage(page + 1)}>下一页</Button></div></div> : !loading && !failures.length ? <StateView type="empty" title={applied ? "当前范围没有数据" : "请选择查询条件"} description="选择节点、指标与时间范围后点击查询。"/> : null}
    </Panel>
  </div></div>;
}
