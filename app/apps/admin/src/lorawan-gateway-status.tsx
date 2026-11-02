import { AdminRuntimeCards } from "./runtime-status";
import { gatewaySnapshot, gatewayStatusKeys, runtimeInfoTime } from "@thcpn/api";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Space, Tag } from "antd";
import { api, formatApiError } from "@thcpn/api";
import { opsTime } from "./admin-device-ops-model";

export function LoRaGatewayStatus({deviceId,name="网关",sn}:{deviceId:string;name?:string;sn?:string}){
 const connection=useQuery({queryKey:["admin","device",deviceId,"lorawan-connection"],queryFn:()=>api.admin.lorawanConnection(deviceId),staleTime:Infinity,refetchOnMount:"always",refetchOnWindowFocus:false,retry:false});
 const activity=useQuery({queryKey:["admin","device",deviceId,"lorawan-activity"],queryFn:()=>api.admin.lorawanActivity(deviceId),staleTime:Infinity,refetchOnMount:"always",refetchOnWindowFocus:false,retry:false});
 const info=useQuery({queryKey:["admin","device",deviceId,"lorawan-info"],queryFn:()=>api.admin.lorawanInfo(deviceId),staleTime:Infinity,refetchOnMount:"always",refetchOnWindowFocus:false,retry:false});
 const state=connection.error?"unknown":connection.data?.state??"unknown";
 return <Card title="网关运行状态" size="small" style={{marginBottom:16}} extra={<Button loading={connection.isFetching||activity.isFetching||info.isFetching} onClick={()=>{void connection.refetch();void activity.refetch();void info.refetch();}}>刷新状态</Button>}>
 <Space orientation="vertical" style={{width:"100%"}}>
  <AdminRuntimeCards deviceId={deviceId} name={name} sn={sn} keys={gatewayStatusKeys} snapshot={gatewaySnapshot(info.data)} loading={info.isFetching} error={info.error?formatApiError(info.error).message:undefined}/>
  {connection.error&&<Alert type="warning" title="连接状态未知" description={formatApiError(connection.error).message}/>}
  {activity.error&&<Alert type="warning" title="活动读取失败" description={formatApiError(activity.error).message}/>}
  <Descriptions size="small" column={{xs:1,sm:2,lg:4}} items={[
   {key:"reported",label:"状态更新时间",children:opsTime(runtimeInfoTime(info.data?.ts))},
   {key:"state",label:"MQTT 连接",children:<Tag color={state==="online"?"green":state==="offline"?"orange":"default"}>{connection.isLoading?"检查中":({online:"在线",offline:"离线",unknown:"未知"})[state]}</Tag>},
   {key:"checked",label:"检查时间",children:connection.error?"—":opsTime(connection.data?.checked_at)},
   {key:"received",label:"最近接收",children:activity.error?"—":opsTime(activity.data?.last_received_at??undefined)},
   {key:"collected",label:"最近采集",children:activity.error?"—":opsTime(activity.data?.last_collected_at??undefined)},
  ]}/>
 </Space>
 </Card>;
}
