import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPinned, RefreshCw } from "lucide-react";
import { api, formatApiError, type DeviceMapItem } from "@thcpn/api";
import { DeviceMap } from "@thcpn/device-map";
import { Button, PageHeader, Panel, StateView } from "@thcpn/ui";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";

export function DeviceMapPage() {
  const { currentId } = useWorkspace();
  const [includeChildren,setIncludeChildren]=useState(false);
  const [ecosystem,setEcosystem]=useState("");
  const [purpose,setPurpose]=useState("");
  const catalog=useQuery({queryKey:["device-taxonomy"],queryFn:api.devices.taxonomy});
  const query=useQuery({queryKey:workspaceQueryKey(currentId,"device-map",String(includeChildren)),queryFn:()=>api.devices.map(currentId!,includeChildren),enabled:Boolean(currentId)});
  const terms=catalog.data?.items??[];
  const rows=useMemo(()=>(query.data?.items??[]).filter((item)=>(!ecosystem||item.environment.ecosystem?.id===ecosystem)&&(!purpose||item.environment.purposes.some((term)=>term.id===purpose))),[query.data,ecosystem,purpose]);
  const located=rows.filter((item)=>item.latitude!==undefined).length;
  return <>
    <PageHeader eyebrow="设备 / 空间分布" title="设备地图" description="按生态类型和观测用途查看当前工作区设备分布。" actions={<Button variant="secondary" onClick={()=>void query.refetch()}><RefreshCw size={14}/>刷新</Button>}/>
    <div className="device-map-stats"><Panel><span>设备</span><strong>{rows.length}</strong></Panel><Panel><span>已定位</span><strong>{located}</strong></Panel><Panel><span>未定位</span><strong>{rows.length-located}</strong></Panel><Panel><span>未分类</span><strong>{rows.filter((item)=>!item.environment.ecosystem).length}</strong></Panel></div>
    <Panel className="device-map-panel"><div className="device-map-toolbar"><select value={ecosystem} onChange={(event)=>setEcosystem(event.target.value)}><option value="">全部生态类型</option>{terms.filter((term)=>term.kind==="ecosystem").map((term)=><option key={term.id} value={term.id}>{term.name_zh}</option>)}</select><select value={purpose} onChange={(event)=>setPurpose(event.target.value)}><option value="">全部观测用途</option>{terms.filter((term)=>term.kind==="purpose").map((term)=><option key={term.id} value={term.id}>{term.name_zh}</option>)}</select><label><input type="checkbox" checked={includeChildren} onChange={(event)=>setIncludeChildren(event.target.checked)}/>显示子节点</label></div>{query.isLoading?<StateView type="loading" title="正在加载设备地图" description="正在读取位置和有效分类。"/>:query.error?<StateView type="error" title="设备地图加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId}/>:rows.length?<><DeviceMap height={520} styleUrl={import.meta.env.VITE_MAP_STYLE_URL} points={rows.map(mapPoint)} onSelect={(id)=>window.location.assign(`/devices/${id}`)}/><div className="device-map-missing"><MapPinned size={15}/>{rows.length-located} 台设备尚未设置坐标，可在设备资料中补全。</div></>:<StateView type="empty" title="没有匹配设备" description="请调整筛选条件。"/>}</Panel>
  </>;
}
function mapPoint(item:DeviceMapItem){return{device_id:item.device_id,name:item.name,device_type:item.device_type,status:item.status,latitude:item.latitude,longitude:item.longitude,child_count:item.child_count,ecosystem:item.environment.ecosystem?.name_zh,purposes:item.environment.purposes.map((term)=>term.name_zh)}}
