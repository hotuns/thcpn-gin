import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatApiError, describeNodeTimeSchedule } from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Button, Panel, StateView } from "./platform-ui";

export function LoRaWANNodeTimeConfig({deviceId,nodeIndex,workspaceId}:{deviceId:string;nodeIndex:number;workspaceId:string}) {
  const {locale}=useLocale();
  const [showHistory,setShowHistory]=useState(false);
  const history=useQuery({queryKey:workspaceQueryKey(workspaceId,"device",deviceId,"node",String(nodeIndex),"time-configs"),queryFn:()=>api.devices.nodeTimeConfigs(deviceId,nodeIndex),enabled:showHistory,retry:false});
  const query=useQuery({queryKey:workspaceQueryKey(workspaceId,"device",deviceId,"node",String(nodeIndex),"time-config"),queryFn:()=>api.devices.nodeTimeConfig(deviceId,nodeIndex),retry:false});
  return <Panel className="section-gap"><div className="panel-header"><h2 className="panel-title">节点时间配置</h2><Button variant="secondary" disabled={query.isFetching} onClick={()=>void query.refetch()}>刷新时间配置</Button></div><div style={{padding:16}}>
    {query.isLoading ? <StateView type="loading" title="正在读取时间配置" description="正在读取源端保存的节点时间配置。"/> : query.error ? <StateView type="error" title="时间配置读取失败" description={formatApiError(query.error).message}/> : !query.data ? <StateView type="empty" title="暂无时间配置" description="源端尚未保存该节点的时间配置。"/> : <><p><strong>{describeNodeTimeSchedule(query.data.content,locale)}</strong></p><p>按设备时钟执行；源端保存不代表设备已应用。</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{query.data.content}</pre><p>更新时间：{new Date(query.data.updated_at ?? query.data.created_at).toLocaleString()}</p></>}
    <Button variant="secondary" onClick={()=>setShowHistory(!showHistory)}>{showHistory ? "收起历史时间配置" : "查看历史时间配置"}</Button>
    {showHistory ? history.isLoading ? <StateView type="loading" title="正在读取时间配置" description="正在读取源端保存的节点时间配置。"/> : history.error ? <StateView type="error" title="时间配置读取失败" description={formatApiError(history.error).message}/> : <div>{(history.data ?? []).map(item=><section key={item.id}><p>#{item.id} · {new Date(item.created_at).toLocaleString()}</p><p>{describeNodeTimeSchedule(item.content,locale)}</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.content}</pre></section>)}</div> : null}
  </div></Panel>;
}
