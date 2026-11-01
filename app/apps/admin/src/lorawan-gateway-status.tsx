import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Space, Tag } from "antd";
import { api, formatApiError } from "@thcpn/api";
import { opsTime } from "./admin-device-ops-model";

export function LoRaGatewayStatus({deviceId}:{deviceId:string}){
 const connection=useQuery({queryKey:["admin","device",deviceId,"lorawan-connection"],queryFn:()=>api.admin.lorawanConnection(deviceId),staleTime:30000,retry:false});
 const activity=useQuery({queryKey:["admin","device",deviceId,"lorawan-activity"],queryFn:()=>api.admin.lorawanActivity(deviceId),staleTime:30000,retry:false});
 const state=connection.error?"unknown":connection.data?.state??"unknown";
 return <Card title="网关连接与活动" size="small" style={{marginBottom:16}} extra={<Button loading={connection.isFetching||activity.isFetching} onClick={()=>{void connection.refetch();void activity.refetch();}}>刷新状态</Button>}>
 <Space orientation="vertical" style={{width:"100%"}}>
  {connection.error&&<Alert type="warning" title="连接状态未知" description={formatApiError(connection.error).message}/>}
  {activity.error&&<Alert type="warning" title="活动读取失败" description={formatApiError(activity.error).message}/>}
  <Descriptions size="small" column={{xs:1,sm:2,lg:4}} items={[
   {key:"state",label:"MQTT 连接",children:<Tag color={state==="online"?"green":state==="offline"?"orange":"default"}>{connection.isLoading?"检查中":({online:"在线",offline:"离线",unknown:"未知"})[state]}</Tag>},
   {key:"checked",label:"检查时间",children:connection.error?"—":opsTime(connection.data?.checked_at)},
   {key:"received",label:"最近接收",children:activity.error?"—":opsTime(activity.data?.last_received_at??undefined)},
   {key:"collected",label:"最近采集",children:activity.error?"—":opsTime(activity.data?.last_collected_at??undefined)},
  ]}/>
 </Space>
 </Card>;
}
