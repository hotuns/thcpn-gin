import { useQuery } from "@tanstack/react-query";
import { api } from "@thcpn/api";
export function ObservationStartInfo({deviceId,nodeIndex=0}:{deviceId:string;nodeIndex?:number}){
 const query=useQuery({queryKey:["device",deviceId,"observation-start",nodeIndex],queryFn:()=>api.devices.observationStarts(deviceId,nodeIndex)});
 return query.data?.effective_start_at?<div style={{padding:"12px 16px"}}>正式观测起始时间：{new Date(query.data.effective_start_at).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</div>:null;
}
