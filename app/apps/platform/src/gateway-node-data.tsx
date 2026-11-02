import { NodeRuntimeDetails } from "./runtime-status";
import { nodeHistoryNotice } from "@thcpn/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./platform-ui";
import { nodeOptionLabel } from "@thcpn/api";
import { isMeasurement, streamPurpose } from "@thcpn/api";
import { ObservationStartInfo } from "./observation-start-info";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { Check, GripVertical, Search } from "lucide-react";
import { api, formatApiError, type Device, type GatewayNode, type TelemetrySeries } from "@thcpn/api";
import { fullTelemetry } from "./full-telemetry";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Panel, SelectInput, StateView, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./platform-ui";
import { TelemetryTable } from "./telemetry-table";
import { TelemetryCharts } from "./telemetry-charts";
import { TelemetryLoading } from "./telemetry-loading";
import { DeviceQueryToolbar, initialQueryRange } from "./device-query-toolbar";
import { LoRaWANNodeTimeConfig } from "./lorawan-node-time-config";

export const nodeDeviceId = (node: GatewayNode) => node.target.kind === "device" ? node.target.device_id : node.target.gateway_device_id;
export const nodeMetricKey = (stream: GatewayNode["streams"][number]) => `${stream.code}\u0000${stream.unit ?? ""}`;

export function GatewayNodeData({ gateway, workspaceId, purpose = "measurement" }: { gateway: Device; workspaceId: string; purpose?: "measurement" | "status" }) {
  const [params, setParams] = useSearchParams();
  const [nodeScope,setNodeScope]=useState<"bound"|"history">(params.get("node_scope")==="history"?"history":"bound");
  const nodesQuery = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", gateway.id, "nodes", "all"),
    queryFn: () => api.devices.nodes(gateway.id,"all"),
  });
  const streamsQuery = useQuery({queryKey:workspaceQueryKey(workspaceId,"device",gateway.id,"streams","runtime"),queryFn:()=>api.dataStreams.list(gateway.id),enabled:purpose === "status"});
  const nodes = useMemo(() => {
    const raw = nodesQuery.data?.items ?? [];
    const result = raw.filter(node=>gateway.source_family!=="lorawan_v2" || (nodeScope==="bound"?node.bound:!node.bound)).map(node=>({...node,streams:node.streams.filter(stream=>purpose === "measurement" ? isMeasurement(stream) : streamPurpose(stream) === "status")}));
    if (purpose === "status") {
      const childIds = new Set(raw.flatMap(node=>node.streams.map(stream=>stream.id)));
      result.unshift({key:`device:${gateway.id}`,name:"网关自身",custom_name:"",can_rename:false,bound:true,target:{kind:"device",device_id:gateway.id},streams:(streamsQuery.data?.items??[]).filter(stream=>stream.status === "active" && streamPurpose(stream) === "status" && !childIds.has(stream.id))});
    }
    return result;
  },[nodesQuery.data,streamsQuery.data,gateway.id,gateway.source_family,purpose,nodeScope]);
  const requestedNode = params.get("node") ?? "";
  useEffect(()=>{if(nodesQuery.data?.items.some(node=>node.key===requestedNode && node.target.kind==="gateway_node" && !node.bound))setNodeScope("history");},[nodesQuery.data,requestedNode]);
  const selectedNode = nodes.some((node) => node.key === requestedNode) ? requestedNode : nodes[0]?.key ?? "";
  const currentNode = nodes.find(node=>node.key===selectedNode);
  const indexed = gateway.source_family === "lorawan_v2";
  const [scheduleOpen,setScheduleOpen]=useState(false);
  const [statusOpen,setStatusOpen]=useState(false);
  const [mode, setMode] = useState<"node" | "compare">("node");
  const [range, setRange] = useState(() => initialQueryRange(gateway.source_family === "lorawan_v2" ? 6 : 168));
  const draggedMetric = useRef<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [draggedMetricKey, setDraggedMetricKey] = useState("");
  const [dragOverMetricKey, setDragOverMetricKey] = useState("");
  const draggedMetricRef = useRef(false);
  const [applied, setApplied] = useState<{ mode: "node" | "compare"; node: string; metrics: string[]; start: string; end: string } | null>(null);

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
    queryKey: workspaceQueryKey(workspaceId, "gateway", gateway.id, "telemetry-full", group.deviceId, group.streams.map((stream) => stream.id).join(","), applied?.start ?? "", applied?.end ?? ""),
    queryFn: () => fullTelemetry(group.deviceId, {
      startTime: new Date(applied!.start).toISOString(), endTime: new Date(applied!.end).toISOString(),
      dataStreamIds: group.streams.map((stream) => stream.id),
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

    const next = { ...range, node: selectedNode, metrics: [...selected], mode };
    if (!dirty) void Promise.all(queries.map((query) => query.refetch()));
    else setApplied(next);
  };
  const moveSelectedMetric = (targetKey: string) => {
    const from = selected.indexOf(draggedMetricKey);
    const to = selected.indexOf(targetKey);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...selected];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setSelected(next);
  };
  const finishMetricDrag = () => {
    setDraggedMetricKey("");
    setDragOverMetricKey("");
    window.setTimeout(() => { draggedMetricRef.current = false; }, 0);
  };
  const selectNode = (key: string) => setParams((current) => { const next = new URLSearchParams(current); next.set("node", key); return next; }, { replace: true });
  const points = series.flatMap((item) => item.points.map((point) => ({ ...point, series: item })));

  return <div className="device-data-layout"><div className="device-data-content gateway-node-data">
    {purpose === "measurement"&&indexed&&currentNode?.target.kind==="gateway_node"&&<Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}><DialogContent><DialogHeader><DialogTitle>节点时间配置</DialogTitle><DialogDescription>{currentNode.name}</DialogDescription></DialogHeader>{scheduleOpen&&<LoRaWANNodeTimeConfig deviceId={gateway.id} workspaceId={workspaceId} nodeIndex={currentNode.target.node_index}/>}</DialogContent></Dialog>}
    {indexed&&currentNode&&<Dialog open={statusOpen} onOpenChange={setStatusOpen}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>{currentNode.name} · 运行状态</DialogTitle></DialogHeader>{statusOpen&&<NodeRuntimeDetails deviceId={gateway.id} workspaceId={workspaceId} node={currentNode}/>}</DialogContent></Dialog>}
    <Panel className="gateway-node-query">
      <div className="panel-header"><div><h2 className="panel-title">{purpose === "status" ? "运行状态" : "节点采集数据"}</h2></div><div className="header-actions">{indexed&&currentNode?.bound&&<Button variant="secondary" onClick={()=>setStatusOpen(true)}>查看运行状态</Button>}{purpose === "measurement"&&indexed&&mode==="node"&&currentNode&&<Button variant="secondary" onClick={()=>setScheduleOpen(true)}>查看采集时间</Button>}{dirty && <Badge tone="warning">条件未应用</Badge>}<Button disabled={invalid || !selected.length || loading || !selectedNode} onClick={search}><Search size={14}/>{loading ? "查询中…" : dirty ? "查询" : "刷新"}</Button></div></div>
      {purpose === "measurement"&&currentNode&&<ObservationStartInfo deviceId={currentNode.target.kind==="device"?currentNode.target.device_id:gateway.id} nodeIndex={currentNode.target.kind==="gateway_node"?currentNode.target.node_index:0}/>}
      {(nodesQuery.error || streamsQuery.error) && <StateView type="error" title="节点加载失败" description={formatApiError(nodesQuery.error || streamsQuery.error).message} />}
      {(nodesQuery.isLoading || purpose === "status" && streamsQuery.isLoading) ? <StateView type="loading" title="正在加载节点" description="正在读取节点与指标。" /> : <>
        <div className="gateway-node-query-fields">
          {indexed&&<label className="field"><span className="field-label">节点范围</span><SelectInput value={nodeScope} onChange={event=>{const scope=event.target.value as "bound"|"history";setNodeScope(scope);const first=nodesQuery.data?.items.find(node=>scope==="bound"?node.bound:!node.bound);setParams(previous=>{const next=new URLSearchParams(previous);next.set("node_scope",scope);if(first)next.set("node",first.key);else next.delete("node");return next;},{replace:true});}}><option value="bound">当前节点</option><option value="history">历史数据</option></SelectInput></label>}

          <label className="field"><span className="field-label">查询方式</span><SelectInput value={mode} onChange={(event) => setMode(event.target.value as "node" | "compare")}><option value="node">节点数据</option><option value="compare">节点对比</option></SelectInput></label>
          {mode === "node" && <label className="field"><span className="field-label">{purpose === "status" ? "设备" : "节点"}</span><SelectInput value={selectedNode} onChange={(event) => selectNode(event.target.value)} disabled={!nodes.length}>{nodes.map((node) => <option key={node.key} value={node.key}>{nodeOptionLabel(node)}</option>)}</SelectInput></label>}
        </div>
        <DeviceQueryToolbar range={range} onChange={setRange}/>
        {mode === "compare" ? <label className="field gateway-node-compare-field"><span className="field-label">对比指标</span><SelectInput value={selected[0] ?? ""} onChange={(event) => setSelected([event.target.value])}>{metrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.name}{metric.unit ? ` · ${metric.unit}` : ""} · {metric.count} 个节点</option>)}</SelectInput></label> : <fieldset className="gateway-node-metric-field"><legend className="field-label">{purpose === "status" ? "状态项目" : "指标"}</legend><div className="gateway-node-metric-checks">{[...metrics].sort((a,b) => (selected.includes(a.key) ? selected.indexOf(a.key) : metrics.length) - (selected.includes(b.key) ? selected.indexOf(b.key) : metrics.length)).map((metric) => {
          const checked = selected.includes(metric.key);
          return <button key={metric.key} type="button" draggable={checked} onDragStart={(event) => { if (!checked) return; draggedMetricRef.current = true; setDraggedMetricKey(metric.key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", metric.key); }} onDragOver={(event) => { if (!draggedMetricKey || !checked) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverMetricKey(metric.key); }} onDrop={(event) => { event.preventDefault(); moveSelectedMetric(metric.key); finishMetricDrag(); }} onDragEnd={finishMetricDrag} onClick={() => { if (draggedMetricRef.current) return; setSelected((current) => checked ? current.filter((key) => key !== metric.key) : [...current, metric.key]); }} className={[checked ? "selected" : "", draggedMetricKey === metric.key ? "dragging" : "", dragOverMetricKey === metric.key ? "drag-over" : ""].filter(Boolean).join(" ")}><GripVertical className="gateway-node-metric-drag-handle" size={13} aria-hidden="true"/><span className="gateway-node-metric-check">{checked && <Check size={12}/>}</span><span className="gateway-node-metric-copy"><strong>{metric.name}</strong><small>{metric.unit || "无单位"}</small></span></button>;
        })}</div></fieldset>}
        {!nodes.length && !nodesQuery.error && <StateView type="empty" title="暂无节点" description="当前组网站还没有配置节点。"/>}
        {nodes.length > 0 && !metrics.length && <StateView type="empty" title={purpose === "status" ? "暂无运行状态" : "暂无采集指标"} description=""/>}
      </>}
    </Panel>
    <Panel className="section-gap gateway-node-chart-panel">

      <div className="panel-header"><h2 className="panel-title">{applied?.mode === "compare" ? "节点对比" : "数据结果"}</h2>{indexed&&<TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost">历史归属</Button></TooltipTrigger><TooltipContent>{nodeHistoryNotice}</TooltipContent></Tooltip></TooltipProvider>}<div className="header-actions"><Link className="button button-secondary" to={`/exports?${new URLSearchParams({system:"group",gateway:gateway.id,nodes:(mode === "node" ? nodes.filter(node=>node.key===selectedNode) : nodes).filter(node=>node.target.kind!=="device" || node.target.device_id!==gateway.id).map(node=>node.key).join(","),start:range.start,end:range.end,node_scope:nodeScope,...(purpose === "status" ? {status:"1",data:"0"} : {})})}`}>导出</Link><Button variant="secondary" onClick={() => setView(view === "chart" ? "table" : "chart")}>{view === "chart" ? "查看表格" : "查看曲线"}</Button></div></div>
      {failures.map((failure) => <Alert key={failure.label} variant="destructive" className="request-error-inline"><AlertTitle>{failure.label}读取失败</AlertTitle><AlertDescription><p>{formatApiError(failure.error).message}</p></AlertDescription></Alert>)}
      {series.filter((item) => item.error).map((item) => <Alert key={item.data_stream_id} variant="destructive" className="request-error-inline"><AlertTitle>{item.name}读取失败</AlertTitle><AlertDescription><p>{item.error}</p></AlertDescription></Alert>)}
      {series.some((item) => !item.complete && !item.error) && <div className="command-note">部分指标数据不完整，请缩小时间范围后重试。</div>}
      {series.flatMap((item) => item.warnings ?? []).map((warning, index) => <div key={index} className="command-note">{warning.message}</div>)}
      {loading ? <TelemetryLoading/> : points.length > 0 && applied ? view === "chart" ? <TelemetryCharts series={series} startTime={applied.start} endTime={applied.end} displayMode={applied.mode === "compare" ? "compare" : undefined}/> : <TelemetryTable key={`${applied.node}:${applied.mode}:${applied.start}:${applied.end}:${applied.metrics.join(",")}`} points={points} formatTime={(value) => value ? new Date(value).toLocaleString() : "—"} /> : !failures.length ? <StateView type="empty" title={applied ? "当前范围没有数据" : "请选择查询条件"} description="选择节点、指标与时间范围后点击查询。"/> : null}
    </Panel>
  </div></div>;
}
