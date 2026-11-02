import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Empty, Spin } from "antd";
import { api, formatApiError } from "@thcpn/api";

export function AdminReportedLocation({deviceId}:{deviceId:string}) {
  const query=useQuery({queryKey:["admin","device",deviceId,"lorawan-info"],queryFn:()=>api.admin.lorawanInfo(deviceId),staleTime:Infinity,refetchOnWindowFocus:false,retry:false});
  const info=query.data;
  const date=info?.ts?.$date;
  const raw=typeof date==="object"&&date ? (date as Record<string,unknown>).$numberLong : date;
  const time=typeof raw==="string"&&!/^\d+$/.test(raw)?Date.parse(raw):Number(raw);
  return <Card size="small" title="网关上报位置" extra={<Button loading={query.isFetching} onClick={()=>void query.refetch()}>刷新</Button>}>
    {query.isLoading ? <Spin/> : query.error ? <Alert type="error" title="定位读取失败" description={formatApiError(query.error).message}/> : !info ? <Empty description="暂无定位上报"/> : <Descriptions items={[
      {key:"longitude",label:"经度",children:info.longitude==null?"—":`${info.longitude}°`},
      {key:"latitude",label:"纬度",children:info.latitude==null?"—":`${info.latitude}°`},
      {key:"altitude",label:"海拔",children:info.altitude==null?"—":`${info.altitude} m`},
      {key:"time",label:"采集时间（北京时间）",children:Number.isFinite(time)&&time>0?new Date(time).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"—"},
    ]}/>}
  </Card>;
}
