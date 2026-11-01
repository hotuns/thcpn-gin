import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "@thcpn/api";
import { Alert, AlertDescription, Panel, StateView } from "./platform-ui";

export function LoRaWANGatewayDetails({deviceId}:{deviceId:string}){
 const query=useQuery({queryKey:["device",deviceId,"gateway-details"],queryFn:()=>api.devices.gatewayDetails(deviceId)});
 return <Panel className="section-gap"><div className="panel-header"><h2 className="panel-title">网关扩展信息</h2></div>
  {query.isLoading?<StateView type="loading" title="正在读取扩展信息" description=""/>:query.error?<Alert variant="destructive"><AlertDescription>{formatApiError(query.error).message}</AlertDescription></Alert>:<dl style={{padding:16,display:"grid",gap:16}}>
   {[{key:"app_key",label:"AppKey"},{key:"eui",label:"EUI"},{key:"wifi_name",label:"Wi-Fi 名称"}].map(field=><div key={field.key}><dt>{field.label}</dt><dd style={{overflowWrap:"anywhere",userSelect:"text"}}>{query.data?.[field.key as keyof NonNullable<typeof query.data>]||"未登记"}</dd></div>)}
  </dl>}
 </Panel>;
}
