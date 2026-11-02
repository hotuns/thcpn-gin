import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs, {type Dayjs} from "dayjs";
import { Alert, Button, DatePicker, Empty, Modal, Select, Segmented, Space, Spin, Table, Tooltip, Typography } from "antd";
import { ThunderboltOutlined, WifiOutlined, DatabaseOutlined, DashboardOutlined } from "@ant-design/icons";
import { api, formatApiError, nodeSnapshot, nodeStatusKeys, statusMetrics, statusValue, statusHistory, nodeHistoryNotice, type StatusMetric, type StatusSnapshot, type GatewayNode, type NodeRuntime } from "@thcpn/api";
import { adminFullTelemetry } from "./admin-full-telemetry";
import { Curve } from "./admin-data-charts";
import { opsTime,telemetryRows } from "./admin-device-ops-model";
const icons={battery:<ThunderboltOutlined/>,rssi:<WifiOutlined/>,sd_card_rate:<DatabaseOutlined/>,snr:<DashboardOutlined/>,cell:<WifiOutlined/>};
export function AdminRuntimeCards({deviceId,name,sn,keys,snapshot,loading=false,error}:{deviceId:string;name:string;sn?:string;keys:StatusMetric[];snapshot:StatusSnapshot;loading?:boolean;error?:string}){
 const [metric,setMetric]=useState<StatusMetric|null>(null);
 return <><div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(120px,1fr))",gap:6}}>{keys.map(key=><Tooltip key={key} title="查看历史"><Button style={{height:"auto",padding:"7px 10px",textAlign:"left",display:"block"}} onClick={()=>setMetric(key)}><Space size={5} style={{fontSize:11,color:"var(--ant-color-text-secondary)"}}>{icons[key]}{statusMetrics[key].label}</Space><div style={{fontVariantNumeric:"tabular-nums",fontWeight:600}}>{loading?"…":error||snapshot.error?"—":statusValue(key,snapshot.values[key])}</div></Button></Tooltip>)}</div>{(error||snapshot.error)&&<Typography.Text type="danger">{error||snapshot.error}</Typography.Text>}
 <Modal title={`${name}${sn?` · 当前 SN ${sn}`:""} · ${metric?statusMetrics[metric].label:"运行状态"}`} open={metric!==null} onCancel={()=>setMetric(null)} footer={null} width="80vw" destroyOnHidden styles={{body:{maxHeight:"78vh",overflowY:"auto"}}}>{metric&&<AdminStatusHistory deviceId={deviceId} keys={keys} snapshot={snapshot} metric={metric} onMetric={setMetric}/>}</Modal></>;
}
function AdminStatusHistory({deviceId,keys,snapshot,metric,onMetric}:{deviceId:string;keys:StatusMetric[];snapshot:StatusSnapshot;metric:StatusMetric;onMetric:(key:StatusMetric)=>void}){
 const initial=()=>[dayjs().subtract(6,"hour"),dayjs()] as [Dayjs,Dayjs];
 const [range,setRange]=useState<[Dayjs,Dayjs]|null>(initial);
 const [applied,setApplied]=useState(()=>({startTime:range![0].toISOString(),endTime:range![1].toISOString()}));
 const [view,setView]=useState("chart");
 const id=snapshot.history[metric];
 const query=useQuery({queryKey:["admin","status-history",deviceId,id,applied],queryFn:()=>adminFullTelemetry(deviceId,{...applied,dataStreamIds:[id]}),enabled:!!id,refetchOnWindowFocus:false,retry:false});
 const series=statusHistory(query.data?.series??[],metric);
 const rows=telemetryRows(series);
 return <Space orientation="vertical" size="middle" style={{width:"100%"}}>
 <Space wrap><Select aria-label="状态项目" value={metric} onChange={onMetric} style={{width:180}} options={keys.map(key=>({value:key,label:statusMetrics[key].label}))}/><Typography.Text strong>最新值 {statusValue(metric,snapshot.values[metric])}</Typography.Text><Typography.Text>采集时间 {opsTime(snapshot.sampledAt)}</Typography.Text>{keys.includes("rssi")&&<Tooltip title={nodeHistoryNotice}><Button type="text">历史归属</Button></Tooltip>}</Space>
 <Space wrap><DatePicker.RangePicker showTime value={range} onChange={value=>setRange(value&&value[0]&&value[1]?[value[0],value[1]]:null)} presets={[6,24,72,168].map(hours=>({label:hours<=24?`${hours} 小时`:`${hours/24} 天`,value:[dayjs().subtract(hours,"hour"),dayjs()] as [Dayjs,Dayjs]}))}/><Button type="primary" loading={query.isFetching} disabled={!range||!range[1].isAfter(range[0])} onClick={()=>{if(!range)return;const next={startTime:range[0].toISOString(),endTime:range[1].toISOString()};if(next.startTime===applied.startTime&&next.endTime===applied.endTime)void query.refetch();else setApplied(next);}}>查询 / 刷新</Button><Segmented value={view} onChange={setView} options={[{value:"chart",label:"曲线"},{value:"table",label:"表格"}]}/></Space>
 {!id?<Empty description="暂未建立该状态的历史查询"/>:query.isFetching?<Spin tip="正在读取完整历史…"><div style={{height:360}}/></Spin>:query.error?<Alert type="error" title="历史查询失败" description={formatApiError(query.error).message} action={<Button onClick={()=>void query.refetch()}>重试</Button>}/>:series.some(item=>item.error)?<Alert type="error" title="历史查询失败" description={series.find(item=>item.error)?.error} action={<Button onClick={()=>void query.refetch()}>重试</Button>}/>:!rows.length?<Empty description="当前范围没有数据"/>:view==="table"?<Table rowKey="key" size="small" dataSource={rows} pagination={{pageSize:50,showSizeChanger:true}} columns={[{title:"时间（北京时间）",dataIndex:"timestamp",render:opsTime},{title:statusMetrics[metric].label,dataIndex:id,render:value=>statusValue(metric,value)}]}/>:<Curve series={{id,name:statusMetrics[metric].label,code:metric,unit:statusMetrics[metric].unit,points:series[0].points}} colorIndex={0} expanded/>}
 </Space>;
}
export function AdminNodeStatus({deviceId,node,reading,loading=false,error,showTime=false}:{deviceId:string;node:GatewayNode;reading?:NodeRuntime;loading?:boolean;error?:string;showTime?:boolean}){
 const index=node.target.kind==="gateway_node"?node.target.node_index:0;
 const query=useQuery({queryKey:["admin","device",deviceId,"node-status-detail",index],queryFn:()=>api.admin.nodeRuntime(deviceId,[index]),enabled:!!index&&!!node.bound&&!reading&&!loading&&!error,refetchOnWindowFocus:false,retry:false,staleTime:Infinity});
 const value=reading??query.data?.items.find(item=>item.key===node.key);
 return <>{!reading&&<Button disabled={!node.bound||query.isFetching} onClick={()=>void query.refetch()} style={{marginBottom:8}}>刷新状态</Button>}<AdminRuntimeCards deviceId={deviceId} name={node.name} sn={node.node_sn} keys={nodeStatusKeys} snapshot={nodeSnapshot(value)} loading={loading||query.isFetching} error={error||(query.error?formatApiError(query.error).message:undefined)}/>{showTime&&<Typography.Text>状态更新时间 {opsTime(value?.sampled_at)}</Typography.Text>}</>;
}
