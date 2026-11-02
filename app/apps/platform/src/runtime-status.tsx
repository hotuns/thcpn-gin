import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Battery, Signal, HardDrive, Radio } from "lucide-react";
import { api, formatApiError, nodeSnapshot, nodeStatusKeys, statusMetrics, statusValue, statusHistory, nodeHistoryNotice, type StatusMetric, type StatusSnapshot } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, SelectInput, StateView, Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "./platform-ui";
import { initialQueryRange, DeviceQueryToolbar } from "./device-query-toolbar";
import { fullTelemetry } from "./full-telemetry";
import { TelemetryChart } from "./telemetry-charts";
import { TelemetryTable } from "./telemetry-table";
import { TelemetryLoading } from "./telemetry-loading";
import { gatewayStatusTime } from "./lorawan-gateway-status";
import "./runtime-status.css";
const icons={battery:Battery,rssi:Signal,sd_card_rate:HardDrive,snr:Radio,cell:Signal};
export function RuntimeStatusCards({deviceId,workspaceId,name,sn,keys,snapshot,loading=false,error}:{deviceId:string;workspaceId:string;name:string;sn?:string;keys:StatusMetric[];snapshot:StatusSnapshot;loading?:boolean;error?:string}){
  const [metric,setMetric]=useState<StatusMetric|null>(null);
  return <><div className="runtime-status-grid">{keys.map(key=>{const Icon=icons[key];return <TooltipProvider key={key}><Tooltip><TooltipTrigger asChild><Button variant="ghost" className="runtime-status-value" onClick={()=>setMetric(key)}><span><Icon size={14}/>{statusMetrics[key].label}</span><strong>{loading?"…":error||snapshot.error?"—":statusValue(key,snapshot.values[key])}</strong></Button></TooltipTrigger><TooltipContent>查看历史</TooltipContent></Tooltip></TooltipProvider>;})}</div>
    {(error||snapshot.error)&&<span role="status">{error||snapshot.error}</span>}
    <Dialog open={metric!==null} onOpenChange={open=>{if(!open)setMetric(null);}}><DialogContent style={{width:"80vw",maxWidth:"80vw",maxHeight:"90vh",overflowY:"auto"}} aria-describedby={undefined}><DialogHeader><DialogTitle>{name}{sn?` · 当前 SN ${sn}`:""} · {metric?statusMetrics[metric].label:"运行状态"}</DialogTitle></DialogHeader>{metric&&<StatusHistoryBody deviceId={deviceId} workspaceId={workspaceId} keys={keys} snapshot={snapshot} metric={metric} onMetric={setMetric}/>}</DialogContent></Dialog>
  </>;
}
function StatusHistoryBody({deviceId,workspaceId,keys,snapshot,metric,onMetric}:{deviceId:string;workspaceId:string;keys:StatusMetric[];snapshot:StatusSnapshot;metric:StatusMetric;onMetric:(key:StatusMetric)=>void}){
  const [range,setRange]=useState(()=>initialQueryRange(6));
  const [applied,setApplied]=useState(range);
  const [view,setView]=useState("chart");
  const id=snapshot.history[metric];
  const valid=Date.parse(applied.end)>Date.parse(applied.start);
  const query=useQuery({queryKey:workspaceQueryKey(workspaceId,"status-history",deviceId,id??"",applied.start,applied.end),queryFn:()=>fullTelemetry(deviceId,{startTime:new Date(applied.start).toISOString(),endTime:new Date(applied.end).toISOString(),dataStreamIds:[id]}),enabled:!!id&&valid,refetchOnWindowFocus:false,retry:false});
  const series=statusHistory(query.data?.series??[],metric);
  const points=series.flatMap(item=>item.points.map(point=>({...point,series:item})));
  return <><div className="header-actions"><SelectInput aria-label="状态项目" value={metric} onChange={event=>onMetric(event.target.value as StatusMetric)}>{keys.map(key=><option key={key} value={key}>{statusMetrics[key].label}</option>)}</SelectInput><strong>最新值 {statusValue(metric,snapshot.values[metric])}</strong><span>采集时间 {gatewayStatusTime(snapshot.sampledAt)}</span>{keys.includes("rssi")&&<TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost">历史归属</Button></TooltipTrigger><TooltipContent>{nodeHistoryNotice}</TooltipContent></Tooltip></TooltipProvider>}</div>
    <DeviceQueryToolbar range={range} onChange={setRange} presetHours={[6,24,72,168]}/><div className="header-actions"><Button disabled={!Date.parse(range.start)||!(Date.parse(range.end)>Date.parse(range.start))||query.isFetching} onClick={()=>{if(range.start===applied.start&&range.end===applied.end)void query.refetch();else setApplied(range);}}>查询 / 刷新</Button><Button variant="secondary" onClick={()=>setView(view==="chart"?"table":"chart")}>{view==="chart"?"查看表格":"查看曲线"}</Button></div>
    {!id?<StateView type="empty" title="暂未建立该状态的历史查询" description=""/>:query.isFetching?<TelemetryLoading/>:query.error?<StateView type="error" title="历史查询失败" description={formatApiError(query.error).message} action={<Button onClick={()=>void query.refetch()}>重试</Button>}/>:series.some(item=>item.error)?<StateView type="error" title="历史查询失败" description={series.find(item=>item.error)?.error??""} action={<Button onClick={()=>void query.refetch()}>重试</Button>}/>:!points.length?<StateView type="empty" title="当前范围没有数据" description=""/>:view==="table"?<TelemetryTable points={points} formatTime={gatewayStatusTime}/>:<TelemetryChart series={series[0]} colorIndex={0} startTime={applied.start} endTime={applied.end} zoomable expanded/>}
  </>;
}

export function NodeRuntimeDetails({deviceId,workspaceId,node,reading,loading=false}:{deviceId:string;workspaceId:string;node:import("@thcpn/api").GatewayNode;reading?:import("@thcpn/api").NodeRuntime;loading?:boolean}){
  const index=node.target.kind==="gateway_node"?node.target.node_index:0;
  const query=useQuery({queryKey:workspaceQueryKey(workspaceId,"device",deviceId,"node-status-detail",String(index)),queryFn:()=>api.devices.nodeRuntime(deviceId,[index]),enabled:!!node.bound&&!!index&&!reading&&!loading,staleTime:Infinity,refetchOnWindowFocus:false,retry:false});
  const value=reading??query.data?.items.find(item=>item.key===node.key);
  return <>{!reading&&<Button variant="secondary" disabled={!node.bound||query.isFetching} onClick={()=>void query.refetch()}>刷新状态</Button>}<RuntimeStatusCards deviceId={deviceId} workspaceId={workspaceId} name={node.name} sn={node.node_sn} keys={nodeStatusKeys} snapshot={nodeSnapshot(value)} loading={loading||query.isFetching} error={query.error?formatApiError(query.error).message:undefined}/><div>状态更新时间 {gatewayStatusTime(value?.sampled_at)}</div></>;
}
