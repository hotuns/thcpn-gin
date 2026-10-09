import { invalidateNodeNames } from "@thcpn/workspace";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { RadioTower, MoveRight } from "lucide-react";
import { api, formatApiError, type Device } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, IconButton, Panel, StateView, NodeNameEditor } from "./platform-ui";
import { NodeVitals, useNodeRuntime } from "./node-vitals";


export function GatewayOverview({ device, workspaceId }: { device: Device; workspaceId: string }) {
  const queryClient = useQueryClient();
  const [, setParams] = useSearchParams();

  const nodes = useQuery({ queryKey: workspaceQueryKey(workspaceId, "device", device.id, "nodes"), queryFn: () => api.devices.nodes(device.id) });
  const runtime = useNodeRuntime(workspaceId, device.id);
  const readings = new Map(runtime.data?.items.map(item => [item.key, item]));
  const rows = (nodes.data?.items ?? []).map(node => {
    const reading = readings.get(node.key);
    const latest = reading?.sampled_at && Date.now() - Date.parse(reading.sampled_at) <= 3 * 86400000 ? reading.sampled_at : undefined;
    return { node, latest, loading: runtime.isFetching, error: runtime.error ?? reading?.error, complete: true };
  });
  const open = (node?: string) => setParams((current) => { const next = new URLSearchParams(current); next.set("tab", "data"); if (node) next.set("node", node); return next; });
  return <div className="gateway-overview">
    <section className="gateway-overview-hero"><div className="gateway-overview-hero-main"><div className="gateway-overview-icon"><RadioTower size={22}/></div><div><span>组网站概览</span><h2>{device.name}</h2><p>节点配置与最近三天的数据情况</p></div></div><div className="gateway-overview-hero-meta"><Button variant="secondary" onClick={() => { void nodes.refetch(); void runtime.refetch(); }}>刷新</Button></div></section>
    {nodes.error ? <StateView type="error" title="节点读取失败" description={formatApiError(nodes.error).message}/> : nodes.isLoading ? <StateView type="loading" title="正在读取节点" description="正在汇总节点与指标。"/> : <>
      <div className="gateway-overview-kpis"><div><span>配置节点</span><strong>{rows.length}</strong><small>个节点</small></div><div><span>数据指标</span><strong>{rows.reduce((total, row) => total + row.node.streams.length, 0)}</strong><small>个指标</small></div><div><span>最近有数据</span><strong>{rows.filter((row) => row.latest).length}</strong><small>最近三天</small></div><div><span>读取失败</span><strong>{rows.filter((row) => row.error).length}</strong><small>个节点</small></div></div>
      <Panel className="gateway-nodes-panel section-gap"><div className="panel-header"><div><h2 className="panel-title">节点</h2><div className="panel-kicker">选择节点查看数据；没有上报不代表设备离线</div></div><Badge tone="info">{rows.length} 个节点</Badge></div>
      {rows.length ? <div className="gateway-node-table"><div className="gateway-node-table-head"><span>节点</span><span>数据状态</span><span>电量 / 信号</span><span>指标</span><span>最近数据</span><span/></div>{rows.map(({node,latest,loading,error,complete}) => <div key={node.key} className="gateway-node-row"><span><button type="button" className="gateway-node-name-link" onClick={() => open(node.key)}>{node.name}</button>{node.can_rename && <NodeNameEditor name={node.custom_name} allowEmpty={node.target.kind !== "device"} onSave={async name => { if (node.target.kind === "device") await api.devices.update(node.target.device_id, {name}); else await api.devices.renameNode(device.id, node.target.node_index, name); await invalidateNodeNames(queryClient); }}/>}</span><Badge tone={error ? "warning" : latest ? "success" : "neutral"}>{loading ? "读取中" : error ? "读取失败" : !node.streams.length ? "暂无指标" : latest ? "有数据" : "无近期数据"}</Badge><NodeVitals item={readings.get(node.key)} loading={runtime.isLoading} error={runtime.isError}/><span>{node.streams.length} 个{!error && !complete && " · 未完整读取"}</span><time>{error ? typeof error === "string" ? error : formatApiError(error).message : latest ? new Date(latest).toLocaleString() : "—"}</time><IconButton label={`查看${node.name}`} onClick={() => open(node.key)}><MoveRight size={15}/></IconButton></div>)}</div> : <StateView type="empty" title="暂无节点" description="当前组网站尚未配置节点。"/>}
      </Panel>
    </>}
  </div>;
}
