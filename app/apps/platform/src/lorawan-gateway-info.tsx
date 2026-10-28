import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Panel, StateView } from "./platform-ui";
export function LoRaWANGatewayInfo({deviceId,workspaceId}:{deviceId:string;workspaceId:string}) {
  const query=useQuery({queryKey:workspaceQueryKey(workspaceId,"device",deviceId,"lorawan-info"),queryFn:()=>api.devices.lorawanInfo(deviceId),staleTime:60000,retry:false});
  return <Panel className="section-gap"><div className="panel-header"><h2 className="panel-title">设备上报信息</h2></div><div style={{padding:16}}>{query.isLoading ? <StateView type="loading" title="正在读取设备上报信息" description="读取最新网关上报记录。"/> : query.error ? <StateView type="error" title="设备上报信息读取失败" description={formatApiError(query.error).message}/> : query.data ? <dl><dt>设备上报 ICCID</dt><dd>{query.data.iccid || "未上报"}</dd><dt>固件版本</dt><dd>{query.data.firmware_version || "未上报"}</dd></dl> : <StateView type="empty" title="暂无网关上报信息" description="手动记录的物联卡信息不代表设备实际使用的卡。"/>}</div></Panel>;
}
