import { usePolicyLimit } from "../../shared/config/system-policy";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Alert, AlertDescription, Badge, Button, Input, Panel } from "../../shared/ui";

export function DeviceDossier({deviceId,workspaceId,canEdit}:{deviceId:string;workspaceId:string;canEdit:boolean}){
 const maxTags=usePolicyLimit("tag_count",30); const maxTagLength=usePolicyLimit("tag_length",50);
 const client=useQueryClient();const [editing,setEditing]=useState(false);const [tags,setTags]=useState<string[]>([]);const [input,setInput]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const observation=useQuery({queryKey:["device",deviceId,"observation-start"],queryFn:()=>api.devices.observationStarts(deviceId)});
 const installation=useQuery({queryKey:["device",deviceId,"installation"],queryFn:()=>api.devices.installation(deviceId)});
 const key=workspaceQueryKey(workspaceId,"device",deviceId,"tags");
 const query=useQuery({queryKey:key,queryFn:()=>api.devices.tags(deviceId,workspaceId),enabled:!!workspaceId,retry:false});
 useEffect(()=>{if(!editing)setTags(query.data?.tags??[]);},[query.data,editing]);
 const add=()=>{const value=input.trim();if(value&&!tags.includes(value))setTags([...tags,value]);setInput("");};
 const save=async()=>{setBusy(true);setError("");try{const value=input.trim();await api.devices.setTags(deviceId,workspaceId,value&&!tags.includes(value)?[...tags,value]:tags);await client.invalidateQueries({queryKey:key});await client.invalidateQueries({queryKey:workspaceQueryKey(workspaceId,"devices")});setInput("");setEditing(false);}catch(error){setError(formatApiError(error).message);}finally{setBusy(false);}};
 return <Panel className="section-gap">
  <div className="panel-header"><h2 className="panel-title">安装信息与标签</h2>{canEdit&&!query.error&&<Button variant="secondary" disabled={busy} onClick={()=>{setEditing(!editing);setError("");}}> {editing?"取消":"编辑标签"}</Button>}</div>
  <div style={{padding:16,display:"grid",gap:16}}>
   {installation.error?<Alert variant="destructive"><AlertDescription>{formatApiError(installation.error).message}</AlertDescription></Alert>:<dl style={{display:"flex",gap:24,flexWrap:"wrap"}}><div><dt>安装日期</dt><dd>{installation.data?.installed_on??"未设置"}</dd></div><div><dt>正式观测起始时间</dt><dd>{observation.data?.effective_start_at?new Date(observation.data.effective_start_at).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"未设置"}</dd></div><div><dt>项目</dt><dd>{installation.data?.project_name||"未关联"}</dd></div></dl>}
   {query.error?<Alert variant="destructive"><AlertDescription>{formatApiError(query.error).message}</AlertDescription></Alert>:<>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}><span>用户标签</span>{(editing?tags:query.data?.tags??[]).map(tag=><Badge key={tag} tone="neutral">{tag}{editing&&<Button type="button" variant="ghost" disabled={busy} aria-label={`移除标签${tag}`} onClick={()=>setTags(tags.filter(value=>value!==tag))}>×</Button>}</Badge>)}{!tags.length&&!editing&&<span>未设置</span>}</div>
    {editing&&<form style={{display:"flex",gap:8}} onSubmit={event=>{event.preventDefault();add();}}><Input value={input} disabled={busy||tags.length>=maxTags} maxLength={maxTagLength} onChange={event=>setInput(event.target.value)} placeholder="输入标签"/><Button type="submit" variant="secondary" disabled={busy||!input.trim()||tags.length>=maxTags}>添加</Button><Button type="button" disabled={busy} onClick={()=>void save()}>{busy?"保存中…":"保存"}</Button></form>}
   </>}
   {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>
 </Panel>;
}
