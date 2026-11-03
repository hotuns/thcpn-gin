import { RuntimeStatusCards } from "./runtime-status";
import { gatewaySnapshot, gatewayStatusKeys } from "@thcpn/api";
import { LoRaGatewayStatus } from "./lorawan-gateway-status";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError, type Device } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Tabs, TabsList, TabsTrigger } from "../../shared/ui/primitives/tabs";
import { Panel, Button, StateView } from "../../shared/ui";
import { GatewayNodeData } from "./gateway-node-data";
import { gatewayStatusTime } from "./lorawan-gateway-status";

export function reportedTime(raw: Record<string, unknown> | undefined) {
  const date = raw?.$date;
  const value = typeof date === "object" && date ? (date as Record<string,unknown>).$numberLong : date;
  const ms = typeof value === "string" && !/^\d+$/.test(value) ? Date.parse(value) : Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined;
}
function useReportedGateway(deviceId:string, workspaceId:string) {
  return useQuery({queryKey:workspaceQueryKey(workspaceId,"device",deviceId,"lorawan-info"),queryFn:()=>api.devices.lorawanInfo(deviceId),staleTime:Infinity,refetchOnMount:"always",refetchOnWindowFocus:false,retry:false});
}
export function GatewayReportedDetails({deviceId,workspaceId,location=false,name="网关",sn}:{deviceId:string;workspaceId:string;location?:boolean;name?:string;sn?:string}) {
  const query=useReportedGateway(deviceId,workspaceId);
  const info=query.data;
  const values=location ? [["经度",info?.longitude,"°"],["纬度",info?.latitude,"°"],["海拔",info?.altitude,"m"]] : [["电池电压",info?.battery,"V"],["4G 信号质量",info?.cell === 99 ? "未知" : info?.cell,""]];
  return <Panel className={`section-gap ${location ? "" : "gateway-runtime-panel"}`}><div className="panel-header"><h2 className="panel-title">{location?"设备上报位置":"网关运行状态"}</h2>{location&&<Button variant="secondary" disabled={query.isFetching} onClick={()=>void query.refetch()}>刷新</Button>}</div>
    {query.isLoading ? <StateView type="loading" title="正在读取" description=""/> : query.error ? <StateView type="error" title="读取失败" description={formatApiError(query.error).message}/> : !info ? <StateView type="empty" title="暂无上报" description=""/> : !location ? <RuntimeStatusCards deviceId={deviceId} workspaceId={workspaceId} name={name} sn={sn} keys={gatewayStatusKeys} snapshot={gatewaySnapshot(info)}/> : <dl className="gateway-node-facts" style={{padding:16}}>{values.map(([name,value,unit])=><div key={String(name)}><dt>{name}</dt><dd>{value == null ? "—" : `${value}${unit ? ` ${unit}` : ""}`}</dd></div>)}<div><dt>采集时间</dt><dd>{gatewayStatusTime(reportedTime(info.ts))}</dd></div></dl>}
    {!location&&info&&<div>状态更新时间 {gatewayStatusTime(reportedTime(info.ts))}</div>}
    {!location&&<LoRaGatewayStatus deviceId={deviceId} workspaceId={workspaceId} onRefreshInfo={()=>void query.refetch()}/>}
  </Panel>;
}
export function LoRaWANDataView({gateway,workspaceId}:{gateway:Device;workspaceId:string}) {
  return <GatewayNodeData gateway={gateway} workspaceId={workspaceId}/>;
}
