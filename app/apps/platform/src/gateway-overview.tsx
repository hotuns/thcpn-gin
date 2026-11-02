import { RuntimeStatusCards, NodeRuntimeDetails } from "./runtime-status";
import { nodeSnapshot, nodeStatusKeys } from "@thcpn/api";
import { GatewayReportedDetails } from "./lorawan-data-view";
import { isMeasurement } from "@thcpn/api";
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
  const [search, setSearch] = useState("");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const nodes = useQuery({ queryKey: workspaceQueryKey(workspaceId, "device", device.id, "nodes"), queryFn: () => api.devices.nodes(device.id) });
  const rows = nodes.data?.items ?? [];
  const boundRows = lora ? rows.filter(node=>node.bound) : rows;
  const current = rows.find(n => n.key === detailKey);
  const recent = (node: GatewayNode) => { const ts = readings.get(node.key)?.sampled_at; const age = ts ? Date.now() - Date.parse(ts) : -1; return age >= 0 && age <= 3 * 86400000; };
  const visible = rows.filter(n => [n.name, n.node_sn, n.target.kind === "gateway_node" ? String(n.target.node_index) : ""].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const [page,setPage]=useState(1);
  const pageCount=Math.max(1,Math.ceil(visible.length/20));
  const currentPage=Math.min(page,pageCount);
  const pageRows=lora?visible.slice((currentPage-1)*20,currentPage*20):visible;
  const runtime = useNodeRuntime(workspaceId,device.id,lora?pageRows.flatMap(node=>node.target.kind==="gateway_node"?[node.target.node_index]:[]):undefined);
  const readings = new Map(runtime.data?.items.map(item=>[item.key,item]));
  const openData = (node: GatewayNode) => { setDetailKey(null); setParams(previous => { const next = new URLSearchParams(previous); next.set("tab", "data"); next.set("node", node.key); return next; }); };
  const refresh = () => { void nodes.refetch(); if(!lora||pageRows.length)void runtime.refetch(); };
  const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
  return <div className="gateway-overview">
    <section className="gateway-overview-hero"><div className="gateway-overview-hero-main"><div className="gateway-overview-icon"><RadioTower size={22} /></div><div><span>{lora ? "LoRaWAN V2 · 网关与节点" : "THCPN · 组网节点"}</span><h2>{device.name}</h2></div></div><div className="header-actions">{lora&&<Button variant="secondary" onClick={()=>setInfoOpen(true)}>网关上报信息</Button>}<Button variant="secondary" disabled={nodes.isFetching || runtime.isFetching} onClick={refresh}>刷新</Button></div></section>
    {lora && <Dialog open={infoOpen} onOpenChange={setInfoOpen}><DialogContent><DialogHeader><DialogTitle>网关上报信息</DialogTitle><DialogDescription>由设备上报的物联卡和固件信息，与平台人工登记资料区分。</DialogDescription></DialogHeader>{infoOpen&&<LoRaWANGatewayInfo deviceId={device.id} workspaceId={workspaceId}/>}</DialogContent></Dialog>}
    {lora && <GatewayReportedDetails deviceId={device.id} workspaceId={workspaceId} name={device.name} sn={device.serial_no}/>}
    {nodes.error ? <StateView type="error" title="节点读取失败" description={formatApiError(nodes.error).message} /> : nodes.isLoading ? <StateView type="loading" title="正在读取节点" description="正在汇总节点与指标。" /> : <>
      <div className="gateway-overview-kpis">
        <div><span>{lora ? "当前安装节点" : "节点设备"}</span><strong>{lora ? rows.filter(n => n.bound).length : rows.length}</strong></div>
        <div><span>指标数量</span><strong>{boundRows.reduce((sum, n) => sum + n.streams.filter(isMeasurement).length, 0)}</strong></div>
        <div><span>本页最近有数据</span><strong>{pageRows.filter(recent).length}</strong></div>
        <div><span>本页读取失败</span><strong>{pageRows.filter(n => readings.get(n.key)?.error).length}</strong></div>
      </div>
      <Panel className="gateway-nodes-panel section-gap">
        <div className="panel-header"><div><h2 className="panel-title">节点</h2></div><div className="header-actions">{lora&&<Button variant="ghost" onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.set("tab","data");next.set("node_scope","history");next.delete("node");return next;})}>历史数据</Button>}<Badge tone="info">{visible.length} 项</Badge></div></div>
        <div className="gateway-node-toolbar">
          <div className="gateway-node-toolbar-search"><SearchInput aria-label="搜索节点" placeholder="搜索名称、SN 或序号" value={search} onChange={e => setSearch(e.target.value)} />

          </div>
        </div>
        <div className="gateway-node-grid-scroll"><Table><TableHeader><TableRow>
          <TableHead>节点</TableHead>{!lora&&<TableHead>数据状态</TableHead>}<TableHead>{lora?"节点状态":"电量 / 信号"}</TableHead><TableHead>指标</TableHead><TableHead>状态更新时间</TableHead><TableHead>操作</TableHead>
        </TableRow></TableHeader><TableBody>{pageRows.map(node => { const reading = readings.get(node.key); return <TableRow key={node.key}>
          <TableCell><div className="gateway-node-cell"><strong>{node.name}</strong>{lora&&<small>SN {node.node_sn}</small>}<small>{node.target.kind === "gateway_node" ? `序号 ${node.target.node_index}` : "独立节点设备"}</small></div></TableCell>
          {!lora&&<TableCell><Badge tone={reading?.error ? "warning" : recent(node) ? "success" : "neutral"}>{reading?.error ? "读取失败" : recent(node) ? "有数据" : "无近期数据"}</Badge></TableCell>}
          <TableCell>{lora?<RuntimeStatusCards deviceId={device.id} workspaceId={workspaceId} name={node.name} sn={node.node_sn} keys={nodeStatusKeys} snapshot={nodeSnapshot(reading)} loading={runtime.isFetching} error={runtime.error?formatApiError(runtime.error).message:undefined}/>:<NodeVitals item={reading} loading={runtime.isLoading} error={runtime.isError} />}</TableCell><TableCell>{node.streams.filter(isMeasurement).length}</TableCell><TableCell><time>{formatTime(reading?.sampled_at)}</time></TableCell>
          <TableCell><div className="header-actions"><Button variant="ghost" onClick={() => setDetailKey(node.key)}>节点资料</Button><Button variant="secondary" onClick={() => openData(node)}>查看数据</Button></div></TableCell>
        </TableRow>; })}</TableBody></Table></div>
        {!visible.length && <StateView type="empty" title="暂无符合条件的节点" description={lora ? "" : "当前网关尚未关联节点，或没有匹配的搜索结果。"} />}
        {lora&&pageCount>1&&<div className="header-actions"><Button variant="secondary" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</Button><span>{currentPage} / {pageCount}</span><Button variant="secondary" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>下一页</Button></div>}
      </Panel>
    </>}
    <Sheet open={!!current} onOpenChange={open => { if (!open) setDetailKey(null); }}><SheetContent className="gateway-node-detail"><SheetHeader><SheetTitle>节点资料</SheetTitle><SheetDescription>{current?.name}</SheetDescription></SheetHeader>
      {current && <><div className="gateway-node-detail-body">

        {lora&&<NodeRuntimeDetails deviceId={device.id} workspaceId={workspaceId} node={current} reading={readings.get(current.key)} loading={runtime.isFetching}/>}
        <dl className="gateway-node-facts">
          <div><dt>节点名称</dt><dd>{current.name}{current.can_rename && <NodeNameEditor name={current.custom_name} allowEmpty={current.target.kind !== "device"} onSave={async name => { if (current.target.kind === "device") await api.devices.update(current.target.device_id, { name }); else await api.devices.renameNode(device.id, current.target.node_index, name); await invalidateNodeNames(client); }} />}</dd></div>
          {lora&&<><div><dt>节点 SN</dt><dd>{current.node_sn || "—"}</dd></div><div><dt>所属网关</dt><dd>{device.name} · {device.serial_no}</dd></div><div><dt>序号</dt><dd>{current.target.kind === "gateway_node" ? current.target.node_index : "—"}</dd></div></>}
          {!lora&&<div><dt>设备标识</dt><dd className="mono">{current.key}</dd></div>}
          <div><dt>指标数量</dt><dd>{current.streams.filter(isMeasurement).length}</dd></div><div><dt>最近采集时间</dt><dd>{formatTime(readings.get(current.key)?.sampled_at)}</dd></div>
          {current.target.kind === "gateway_node" && <div><dt>经纬度</dt><dd>{current.longitude != null ? `${current.longitude}, ${current.latitude}` : "未设置"}{current.can_rename && <NodeLocationEditor gatewayId={device.id} node={current} />}</dd></div>}
        </dl>
        {current.target.kind === "device" && <Link className="button button-secondary" to={`/devices/${current.target.device_id}?tab=profile`}>打开节点设备详情</Link>}
      </div><SheetFooter><Button variant="secondary" onClick={() => setDetailKey(null)}>关闭</Button><Button onClick={() => openData(current)}>查看节点数据</Button></SheetFooter></>}
    </SheetContent></Sheet>
  </div>;
}
