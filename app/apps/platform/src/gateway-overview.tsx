import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { RadioTower } from "lucide-react";
import { api, formatApiError, type Device, type GatewayNode } from "@thcpn/api";
import { invalidateNodeNames, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Panel, StateView, NodeNameEditor, SearchInput, SelectInput, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, Alert, AlertTitle, AlertDescription, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./platform-ui";
import { NodeVitals, useNodeRuntime } from "./node-vitals";
import { NodeLocationEditor } from "./node-location-editor";
import { LoRaWANGatewayInfo } from "./lorawan-gateway-info";

export function GatewayOverview({ device, workspaceId }: { device: Device; workspaceId: string }) {
  const client = useQueryClient();
  const [, setParams] = useSearchParams();
  const lora = device.source_family === "lorawan_v2";
  const [infoOpen,setInfoOpen]=useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const nodes = useQuery({ queryKey: workspaceQueryKey(workspaceId, "device", device.id, "nodes"), queryFn: () => api.devices.nodes(device.id) });
  const runtime = useNodeRuntime(workspaceId, device.id);
  const readings = new Map(runtime.data?.items.map(item => [item.key, item]));
  const rows = nodes.data?.items ?? [];
  const current = rows.find(n => n.key === detailKey);
  const recent = (node: GatewayNode) => { const ts = readings.get(node.key)?.sampled_at; const age = ts ? Date.now() - Date.parse(ts) : -1; return age >= 0 && age <= 3 * 86400000; };
  const visible = rows.filter(n => (!lora || filter === "all" || (filter === "bound" ? n.bound : !n.bound)) && [n.name, n.node_sn, n.key].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const openData = (node: GatewayNode) => { setDetailKey(null); setParams(previous => { const next = new URLSearchParams(previous); next.set("tab", "data"); next.set("node", node.key); return next; }); };
  const refresh = () => { void nodes.refetch(); void runtime.refetch(); };
  const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
  return <div className="gateway-overview">
    <section className="gateway-overview-hero"><div className="gateway-overview-hero-main"><div className="gateway-overview-icon"><RadioTower size={22} /></div><div><span>{lora ? "LoRaWAN V2 · 网关与节点" : "THCPN · 组网节点"}</span><h2>{device.name}</h2></div></div><div className="header-actions">{lora&&<Button variant="secondary" onClick={()=>setInfoOpen(true)}>网关上报信息</Button>}<Button variant="secondary" disabled={nodes.isFetching || runtime.isFetching} onClick={refresh}>刷新</Button></div></section>
    {lora && <Dialog open={infoOpen} onOpenChange={setInfoOpen}><DialogContent><DialogHeader><DialogTitle>网关上报信息</DialogTitle><DialogDescription>由设备上报的物联卡和固件信息，与平台人工登记资料区分。</DialogDescription></DialogHeader>{infoOpen&&<LoRaWANGatewayInfo deviceId={device.id} workspaceId={workspaceId}/>}</DialogContent></Dialog>}
    {nodes.error ? <StateView type="error" title="节点读取失败" description={formatApiError(nodes.error).message} /> : nodes.isLoading ? <StateView type="loading" title="正在读取节点" description="正在汇总节点与指标。" /> : <>
      <div className="gateway-overview-kpis">
        <div><span>{lora ? "当前安装节点" : "节点设备"}</span><strong>{lora ? rows.filter(n => n.bound).length : rows.length}</strong></div>
        <div><span>指标数量</span><strong>{rows.reduce((sum, n) => sum + n.streams.length, 0)}</strong></div>
        <div><span>近三天有数据</span><strong>{rows.filter(recent).length}</strong></div>
        <div><span>读取失败</span><strong>{rows.filter(n => readings.get(n.key)?.error).length}</strong></div>
      </div>
      <Panel className="gateway-nodes-panel section-gap">
        <div className="panel-header"><div><h2 className="panel-title">节点</h2></div><Badge tone="info">{visible.length} 项</Badge></div>
        <div className="gateway-node-toolbar">
          <div className="gateway-node-toolbar-search"><SearchInput aria-label="搜索节点或采集位置" placeholder="搜索名称、节点 SN 或位置标识" value={search} onChange={e => setSearch(e.target.value)} />
            {lora && <SelectInput aria-label="采集位置范围" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部采集位置</option><option value="bound">有当前安装节点</option><option value="history">未绑定／历史位置</option></SelectInput>}
          </div>
        </div>
        <div className="gateway-node-grid-scroll"><Table><TableHeader><TableRow>
          <TableHead>节点</TableHead><TableHead>{lora ? "物理节点" : "数据状态"}</TableHead><TableHead>电量 / 信号</TableHead><TableHead>指标</TableHead><TableHead>最近采集时间</TableHead><TableHead>操作</TableHead>
        </TableRow></TableHeader><TableBody>{visible.map(node => { const reading = readings.get(node.key); return <TableRow key={node.key}>
          <TableCell><div className="gateway-node-cell"><strong>{node.name}</strong><small>{node.target.kind === "gateway_node" ? `序号 ${node.target.node_index}` : "独立节点设备"}</small></div></TableCell>
          <TableCell>{lora ? <div className="gateway-node-cell"><Badge tone={node.bound ? "info" : "neutral"}>{node.bound ? "已安装" : "未绑定"}</Badge><small>{node.node_sn || "保留位置历史"}</small></div> : <Badge tone={reading?.error ? "warning" : recent(node) ? "success" : "neutral"}>{reading?.error ? "读取失败" : recent(node) ? "有数据" : "无近期数据"}</Badge>}</TableCell>
          <TableCell><NodeVitals item={reading} loading={runtime.isLoading} error={runtime.isError} /></TableCell><TableCell>{node.streams.length}</TableCell><TableCell><time>{formatTime(reading?.sampled_at)}</time></TableCell>
          <TableCell><div className="header-actions"><Button variant="ghost" onClick={() => setDetailKey(node.key)}>节点资料</Button><Button variant="secondary" onClick={() => openData(node)}>查看数据</Button></div></TableCell>
        </TableRow>; })}</TableBody></Table></div>
        {!visible.length && <StateView type="empty" title="暂无符合条件的节点" description={lora ? "可切换到采集位置查看历史，或调整筛选条件。节点安装由后台管理维护。" : "当前网关尚未关联节点，或没有匹配的搜索结果。"} />}
      </Panel>
    </>}
    <Sheet open={!!current} onOpenChange={open => { if (!open) setDetailKey(null); }}><SheetContent className="gateway-node-detail"><SheetHeader><SheetTitle>节点资料</SheetTitle><SheetDescription>{current?.name}</SheetDescription></SheetHeader>
      {current && <><div className="gateway-node-detail-body">
        {lora && <Alert><AlertTitle>区分硬件身份与位置历史</AlertTitle><AlertDescription>当前节点 SN 只表示当前安装关系；此位置的曲线可能包含更换硬件前的数据。</AlertDescription></Alert>}
        <dl className="gateway-node-facts">
          <div><dt>{lora ? "采集位置名称" : "节点名称"}</dt><dd>{current.name}{current.can_rename && <NodeNameEditor name={current.custom_name} allowEmpty={current.target.kind !== "device"} onSave={async name => { if (current.target.kind === "device") await api.devices.update(current.target.device_id, { name }); else await api.devices.renameNode(device.id, current.target.node_index, name); await invalidateNodeNames(client); }} />}</dd></div>
          {lora && <><div><dt>当前节点 SN</dt><dd>{current.node_sn || "未绑定"}</dd></div>{<div><dt>物理节点标识</dt><dd className="mono">{current.physical_node_id || "—"}</dd></div>}<div><dt>安装状态</dt><dd>{current.bound ? "已安装" : "未绑定／历史位置"}</dd></div></>}
          <div><dt>{lora ? "采集位置标识" : "设备标识"}</dt><dd className="mono">{current.key}</dd></div>
          <div><dt>指标数量</dt><dd>{current.streams.length}</dd></div><div><dt>最近采集时间</dt><dd>{formatTime(readings.get(current.key)?.sampled_at)}</dd></div>
          {current.target.kind === "gateway_node" && <div><dt>采集位置坐标</dt><dd>{current.longitude != null ? `${current.longitude}, ${current.latitude}` : "未设置"}{current.can_rename && <NodeLocationEditor gatewayId={device.id} node={current} />}</dd></div>}
        </dl>
        {current.target.kind === "device" && <Link className="button button-secondary" to={`/devices/${current.target.device_id}?tab=profile`}>打开节点设备详情</Link>}
      </div><SheetFooter><Button variant="secondary" onClick={() => setDetailKey(null)}>关闭</Button><Button onClick={() => openData(current)}>{lora ? "查看位置数据" : "查看节点数据"}</Button></SheetFooter></>}
    </SheetContent></Sheet>
  </div>;
}
