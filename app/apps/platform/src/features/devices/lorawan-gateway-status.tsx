import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button } from "../../shared/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../shared/ui/primitives/tooltip";

export function useLoRaGatewayStatus(deviceId:string,workspaceId:string,enabled=true){
 const connection=useQuery({queryKey:workspaceQueryKey(workspaceId,"device",deviceId,"lorawan-connection"),queryFn:()=>api.devices.lorawanConnection(deviceId),enabled,staleTime:Infinity,refetchOnMount:"always",refetchOnWindowFocus:false,retry:false});
 const activity=useQuery({queryKey:workspaceQueryKey(workspaceId,"device",deviceId,"lorawan-activity"),queryFn:()=>api.devices.lorawanActivity(deviceId),enabled,staleTime:Infinity,refetchOnMount:"always",refetchOnWindowFocus:false,retry:false});
 return {connection,activity};
}
export function LoRaConnectionBadge({connection}:{connection:ReturnType<typeof useLoRaGatewayStatus>["connection"]}){
 const state=connection.error?"unknown":connection.data?.state??"unknown";
 const label=connection.isLoading?"检查中":({online:"在线",offline:"离线",unknown:"连接未知"})[state];
 return <TooltipProvider><Tooltip><TooltipTrigger asChild><span tabIndex={0}><Badge tone={state==="online"?"success":state==="offline"?"warning":"neutral"}>{label}</Badge></span></TooltipTrigger><TooltipContent>{connection.error?formatApiError(connection.error).message:connection.data?.checked_at?`检查时间：${gatewayStatusTime(connection.data.checked_at)}`:"尚未取得连接状态"}</TooltipContent></Tooltip></TooltipProvider>;
}
export function gatewayStatusTime(value?:string|null){return value?new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"—";}
export function LoRaGatewayStatus({deviceId,workspaceId,onRefreshInfo}:{deviceId:string;workspaceId:string;onRefreshInfo?:()=>void}){
 const {connection,activity}=useLoRaGatewayStatus(deviceId,workspaceId);
 return <section className="lorawan-gateway-status" aria-label="网关连接与活动">
  <LoRaConnectionBadge connection={connection}/>
  <span>最近接收：{gatewayStatusTime(activity.error?null:activity.data?.last_received_at)}</span>
  <span>最近采集：{gatewayStatusTime(activity.error?null:activity.data?.last_collected_at)}</span>
  <span>检查时间：{gatewayStatusTime(connection.error?null:connection.data?.checked_at)}</span>
  <Button variant="ghost" disabled={connection.isFetching||activity.isFetching} onClick={()=>{void connection.refetch();void activity.refetch();onRefreshInfo?.();}}>刷新状态</Button>
  {activity.error&&<span role="status">活动读取失败</span>}
 </section>;
}
