import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Plus, Trash2 } from "lucide-react";
import { api, formatApiError, type AlertEvent, type AlertRule, type JsonRecord } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, CheckboxInput, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, PageHeader, Panel, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StateView, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "./platform-ui";

const duration = (from:string) => { const seconds=Math.max(0,Math.floor((Date.now()-new Date(from).getTime())/1000));return seconds<3600?`${Math.floor(seconds/60)} 分钟`:seconds<86400?`${Math.floor(seconds/3600)} 小时`:`${Math.floor(seconds/86400)} 天`; };

export function AlertsPage(){
  const {currentId}=useWorkspace();const client=useQueryClient();const [params]=useSearchParams();const [createOpen,setCreateOpen]=useState(params.get("new")==="1");const [message,setMessage]=useState("");
  const rules=useQuery({queryKey:workspaceQueryKey(currentId,"alert-rules"),queryFn:()=>api.alerts.rules(currentId!),enabled:Boolean(currentId)});
  const active=useQuery({queryKey:workspaceQueryKey(currentId,"alert-events","active"),queryFn:()=>api.alerts.events(currentId!,{status:"active"}),enabled:Boolean(currentId),refetchInterval:60_000});
  const history=useQuery({queryKey:workspaceQueryKey(currentId,"alert-events","history"),queryFn:()=>api.alerts.events(currentId!),enabled:Boolean(currentId)});
  const refresh=()=>client.invalidateQueries({queryKey:["workspace",currentId]});
  const acknowledge=useMutation({mutationFn:(id:string)=>api.alerts.acknowledge(currentId!,id),onSuccess:refresh,onError:e=>setMessage(formatApiError(e).message)});
  const toggle=async(rule:AlertRule)=>{try{await api.alerts.updateRule(currentId!,rule.id,rulePayload(rule,!rule.enabled));await refresh()}catch(e){setMessage(formatApiError(e).message)}};
  const archive=async(rule:AlertRule)=>{if(!confirm(`确认归档“${rule.name}”？`))return;try{await api.alerts.archiveRule(currentId!,rule.id);await refresh()}catch(e){setMessage(formatApiError(e).message)}};
  if(!currentId)return <StateView type="empty" title="请先选择组织" description="预警规则属于组织。"/>;
  return <div className="alerts-page"><PageHeader eyebrow="运行" title="预警中心" description="持续监测设备指标与在线状态，只在触发和恢复时通知。" actions={<Button onClick={()=>setCreateOpen(true)}><Plus size={15}/>新建预警</Button>}/>{message&&<div className="form-message error">{message}</div>}
    <Tabs defaultValue="active"><TabsList><TabsTrigger value="active">当前预警 {active.data?.items.length?`(${active.data.items.length})`:""}</TabsTrigger><TabsTrigger value="history">历史记录</TabsTrigger><TabsTrigger value="rules">预警规则</TabsTrigger></TabsList>
      <TabsContent value="active"><EventList loading={active.isLoading} error={active.error} items={active.data?.items??[]} active onAcknowledge={id=>acknowledge.mutate(id)}/></TabsContent>
      <TabsContent value="history"><EventList loading={history.isLoading} error={history.error} items={history.data?.items??[]} onAcknowledge={id=>acknowledge.mutate(id)}/></TabsContent>
      <TabsContent value="rules">{rules.isLoading?<StateView type="loading" title="正在加载规则" description=""/>:rules.isError?<StateView type="error" title="规则加载失败" description={formatApiError(rules.error).message}/>:<div className="alert-rule-list">{rules.data?.items.map(rule=><Panel key={rule.id} className="alert-rule-card"><div><div className="alert-card-title"><Badge tone={rule.severity==="critical"?"danger":"warning"}>{rule.severity==="critical"?"严重":"普通"}</Badge><strong>{rule.name}</strong>{rule.effective_status==="paused_plan"&&<Badge tone="neutral">套餐已暂停</Badge>}</div><p>{ruleSummary(rule)}</p><small>{rule.device_name} · 最近状态：{rule.evaluation_state}{rule.last_error?` · ${rule.last_error}`:""}</small></div><div className="alert-card-actions"><Switch checked={rule.enabled} onCheckedChange={()=>void toggle(rule)} aria-label="启停规则"/><Button variant="ghost" onClick={()=>void archive(rule)}><Trash2 size={15}/>归档</Button></div></Panel>)}{!rules.data?.items.length&&<StateView type="empty" title="还没有预警规则" description="创建阈值或设备离线规则，异常时通知指定成员。"/>}</div>}</TabsContent>
    </Tabs>{createOpen&&<CreateRuleDialog key={currentId} open={createOpen} workspaceId={currentId} initialDeviceId={params.get("device")??""} onClose={()=>setCreateOpen(false)} onSaved={async()=>{setCreateOpen(false);await refresh()}}/>}</div>;
}

function EventList({items,loading,error,active,onAcknowledge}:{items:AlertEvent[];loading:boolean;error:unknown;active?:boolean;onAcknowledge:(id:string)=>void}){if(loading)return <StateView type="loading" title="正在加载预警" description=""/>;if(error)return <StateView type="error" title="预警加载失败" description={formatApiError(error).message}/>;if(!items.length)return <StateView type="empty" title={active?"当前没有预警":"暂无历史记录"} description={active?"设备运行正常。":"触发和恢复记录会保留在这里."}/>;return <div className="alert-event-list">{items.map(item=><Panel key={item.id} className="alert-event-card"><AlertTriangle size={20}/><div><div className="alert-card-title"><Badge tone={item.severity==="critical"?"danger":"warning"}>{item.severity==="critical"?"严重":"普通"}</Badge><strong>{item.title}</strong>{item.resolved_at&&<Badge tone="success">已恢复</Badge>}</div><p>{item.content}</p><small>{item.device_name} · {new Date(item.triggered_at).toLocaleString()} · 持续 {duration(item.triggered_at)}</small></div><div className="alert-card-actions"><Link className="alert-device-link" to={`/devices/${item.device_id}`}>查看设备</Link>{!item.acknowledged_at&&<Button onClick={()=>onAcknowledge(item.id)}><Check size={15}/>确认</Button>}</div></Panel>)}</div>}

export function CreateRuleDialog({open,workspaceId,initialDeviceId,onClose,onSaved}:{open:boolean;workspaceId:string;initialDeviceId:string;onClose:()=>void;onSaved:()=>void}){
  const [step,setStep]=useState(1),[type,setType]=useState("telemetry_threshold"),[deviceId,setDeviceId]=useState(initialDeviceId),[streamId,setStreamId]=useState(""),[mode,setMode]=useState("above");
  const [lower,setLower]=useState(""),[upper,setUpper]=useState(""),[durationMinutes,setDuration]=useState("5"),[offlineMinutes,setOffline]=useState("30"),[severity,setSeverity]=useState("warning");
  const [recipients,setRecipients]=useState<string[]>([]),[search,setSearch]=useState(""),[email,setEmail]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const devices=useQuery({queryKey:workspaceQueryKey(workspaceId,"devices","alerts"),queryFn:()=>api.devices.list(workspaceId),enabled:open});
  const streams=useQuery({queryKey:workspaceQueryKey(workspaceId,"alert-streams",deviceId),queryFn:()=>api.dataStreams.list(deviceId),enabled:open&&Boolean(deviceId)&&type==="telemetry_threshold"});
  const members=useQuery({queryKey:workspaceQueryKey(workspaceId,"members","alerts"),queryFn:()=>api.members.list(workspaceId),enabled:open});
  const selectedDevice=devices.data?.items.find(d=>d.id===deviceId);
  const streamItems=(streams.data?.items??[]).filter(s=>s.type==="telemetry"&&s.status==="active");
  const selectedStream=streamItems.find(s=>s.id===streamId);
  const recipientItems=((members.data?.items??[]) as JsonRecord[]).map(alertRecipientFromMember).filter((item):item is NonNullable<typeof item>=>Boolean(item));
  const visibleRecipients=recipientItems.filter(item=>(item.label+" "+item.detail).toLowerCase().includes(search.toLowerCase()));
  const conditionError=validateAlertCondition({type,mode,lower,upper,durationMinutes,offlineMinutes});
  const targetReady=Boolean(selectedDevice&&(type==="device_offline"||selectedStream));
  const summary=type==="device_offline"
    ? `${selectedDevice?.name??"设备"} 超过 ${offlineMinutes||"—"} 分钟无数据时触发`
    : `${selectedDevice?.name??"设备"}的${selectedStream?.name??"指标"}${mode==="above"?"高于":mode==="below"?"低于":"超出区间"} ${mode==="outside"?`${lower||"—"} – ${upper||"—"}`:mode==="below"?lower||"—":upper||"—"} ${selectedStream?.unit??""} 持续 ${durationMinutes||"—"} 分钟时触发`;
  const submit=async()=>{
    if(busy||!targetReady||conditionError||!recipients.length)return;
    setBusy(true);setError("");
    try{
      const condition:JsonRecord={mode,duration_seconds:Number(durationMinutes)*60,recovery_delta:mode==="outside"?Math.abs(Number(upper)-Number(lower))*.02:Math.abs(Number(mode==="below"?lower:upper))*.02};
      if(mode!=="above")condition.lower=Number(lower);
      if(mode!=="below")condition.upper=Number(upper);
      await api.alerts.createRule(workspaceId,{name:Array.from(summary).slice(0,120).join(""),type,severity,device_id:deviceId,data_stream_id:type==="telemetry_threshold"?streamId:undefined,condition:type==="telemetry_threshold"?condition:undefined,offline_after_seconds:type==="device_offline"?Number(offlineMinutes)*60:undefined,recipient_user_ids:recipients,channels:email?["in_app","email"]:["in_app"],enabled:true});
      onSaved();
    }catch(e){setError(formatApiError(e).message)}finally{setBusy(false)}
  };
  const titles=["监测对象","触发条件","通知接收"];
  return <Dialog open={open} onOpenChange={value=>!value&&!busy&&onClose()}>
    <DialogContent className="alert-rule-dialog shadcn-dialog-form" onEscapeKeyDown={e=>busy&&e.preventDefault()} onPointerDownOutside={e=>e.preventDefault()}>
      <DialogHeader><DialogTitle>新建预警规则</DialogTitle><DialogDescription>选择监测对象，设置触发条件，再指定需要通知的成员。</DialogDescription></DialogHeader>
      <nav className="alert-builder-steps" aria-label="创建步骤">{titles.map((title,index)=><Button key={title} variant="ghost" aria-current={step===index+1?"step":undefined} disabled={busy||(index>0&&!targetReady)||(index>1&&Boolean(conditionError))} onClick={()=>setStep(index+1)}><span>{step>index+1?<Check size={14}/>:index+1}</span>{title}</Button>)}</nav>
      <div className="alert-builder-layout">
        <div className="alert-builder-fields">
          <h3>{titles[step-1]}</h3>
          {step===1&&<>
            <div className="alert-type-options">{[{value:"telemetry_threshold",title:"指标阈值",description:"指标持续越界时通知"},{value:"device_offline",title:"设备离线",description:"设备长时间未上报时通知"}].map(item=><Button key={item.value} variant="secondary" aria-pressed={type===item.value} onClick={()=>setType(item.value)}><strong>{item.title}</strong><small>{item.description}</small></Button>)}</div>
            <Field label="选择设备"><AlertSelect label="选择设备" value={deviceId} placeholder="请选择" onValueChange={value=>{setDeviceId(value);setStreamId("");setLower("");setUpper("")}} options={(devices.data?.items??[]).map(d=>({value:d.id,label:d.name}))}/></Field>
            {devices.isLoading?<p role="status">正在加载设备…</p>:devices.isError?<p role="alert">{formatApiError(devices.error).message}<Button variant="ghost" onClick={()=>void devices.refetch()}>重试</Button></p>:!devices.data?.items.length&&<p>暂无可选设备</p>}
            {type==="telemetry_threshold"&&deviceId&&<><Field label="指标"><AlertSelect label="指标" value={streamId} placeholder="请选择" onValueChange={value=>{setStreamId(value);setLower("");setUpper("")}} options={streamItems.map(s=>({value:s.id,label:s.name+(s.unit?" ("+s.unit+")":"")}))}/></Field>{streams.isLoading?<p role="status">正在加载指标…</p>:streams.isError?<p role="alert">{formatApiError(streams.error).message}<Button variant="ghost" onClick={()=>void streams.refetch()}>重试</Button></p>:!streamItems.length&&<p>该设备暂无可用的数值指标</p>}</>}
          </>}
          {step===2&&<>
            {type==="device_offline"?<Field label="无数据时长（分钟）"><Input aria-label="无数据时长（分钟）" type="number" min="1" step="1" value={offlineMinutes} onChange={e=>setOffline(e.target.value)}/></Field>:<>
              <Field label="条件"><AlertSelect label="条件" value={mode} onValueChange={setMode} options={[{value:"above",label:"高于"},{value:"below",label:"低于"},{value:"outside",label:"超出区间"}]}/></Field>
              <div className="alert-form-grid">{mode!=="above"&&<Field label="下限"><div className="alert-number-unit"><Input aria-label="下限" type="number" step="any" value={lower} onChange={e=>setLower(e.target.value)}/><span>{selectedStream?.unit}</span></div></Field>}{mode!=="below"&&<Field label="上限"><div className="alert-number-unit"><Input aria-label="上限" type="number" step="any" value={upper} onChange={e=>setUpper(e.target.value)}/><span>{selectedStream?.unit}</span></div></Field>}</div>
              <Field label="持续时间（分钟）"><Input aria-label="持续时间（分钟）" type="number" min="0" max="43200" step="1" value={durationMinutes} onChange={e=>setDuration(e.target.value)}/></Field>
              <p className="alert-builder-hint">连续越界达到此时长才触发，避免短暂波动造成误报。0 表示立即触发。</p>
            </>}
            <Field label="严重级别"><AlertSelect label="严重级别" value={severity} onValueChange={setSeverity} options={[{value:"warning",label:"普通"},{value:"critical",label:"严重"}]}/></Field>
            {conditionError&&<p className="alert-builder-validation" role="status">{conditionError}</p>}
          </>}
          {step===3&&<>
            <Field label="接收成员"><Input aria-label="搜索成员" placeholder="搜索姓名、邮箱或手机号" value={search} onChange={e=>setSearch(e.target.value)}/></Field>
            <div className="alert-recipient-list">{visibleRecipients.map(item=><label key={item.id}><CheckboxInput checked={recipients.includes(item.id)} onChange={e=>setRecipients(current=>e.target.checked?[...current,item.id]:current.filter(x=>x!==item.id))}/><span className="alert-recipient-identity"><strong>{item.label}</strong>{item.detail&&<small>{item.detail}</small>}</span></label>)}</div>
            {members.isLoading?<p role="status">正在加载成员…</p>:members.isError?<p role="alert">{formatApiError(members.error).message}<Button variant="ghost" onClick={()=>void members.refetch()}>重试</Button></p>:!visibleRecipients.length&&<p>没有匹配的成员</p>}
            <div className="alert-channel-row"><span><strong>站内通知</strong><small>触发与恢复时通知所选成员</small></span><Badge tone="success">默认开启</Badge></div>
            <div className="alert-channel-row"><span><strong>邮件通知</strong><small>仅发送至已验证邮箱，不影响站内通知</small></span><Switch aria-label="邮件通知" checked={email} onCheckedChange={setEmail}/></div>
          </>}
        </div>
        <aside className="alert-builder-preview"><Badge tone={severity==="critical"?"danger":"warning"}>{severity==="critical"?"严重":"普通"}</Badge><h3>规则预览</h3><p>{summary}</p><dl><div><dt>接收成员</dt><dd>{recipients.length}</dd></div><div><dt>通知渠道</dt><dd>{email?"站内通知 + 邮件":"站内通知"}</dd></div></dl><div className="alert-builder-note"><Check size={15}/><span>首次触发和恢复时各通知一次，持续异常不重复通知。</span></div></aside>
      </div>
      {error&&<div className="form-message error" role="alert">{error}</div>}
      <DialogFooter><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>{step>1&&<Button variant="secondary" disabled={busy} onClick={()=>setStep(step-1)}>上一步</Button>}{step<3?<Button disabled={!targetReady||(step===2&&Boolean(conditionError))} onClick={()=>setStep(step+1)}>下一步</Button>:<Button disabled={busy||!targetReady||Boolean(conditionError)||!recipients.length||members.isError} onClick={()=>void submit()}>{busy?"正在创建…":"创建并启用"}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function validateAlertCondition({type,mode,lower,upper,durationMinutes,offlineMinutes}:{type:string;mode:string;lower:string;upper:string;durationMinutes:string;offlineMinutes:string}){
  const finite=(value:string)=>value.trim()!==""&&Number.isFinite(Number(value));
  if(type==="device_offline")return finite(offlineMinutes)&&Number.isInteger(Number(offlineMinutes))&&Number(offlineMinutes)>=1&&Number(offlineMinutes)*60<=2147483647?"":"无数据时长至少为 1 分钟，请填写整数。";
  if((mode!=="above"&&!finite(lower))||(mode!=="below"&&!finite(upper)))return "请填写有效的阈值。";
  if(mode==="outside"&&Number(lower)>=Number(upper))return "下限必须小于上限。";
  if(!finite(durationMinutes)||!Number.isInteger(Number(durationMinutes))||Number(durationMinutes)<0||Number(durationMinutes)>43200)return "持续时间须为 0–43200 分钟的整数。";
  return "";
}
function Field({label,children}:{label:string;children:ReactNode}){return <div className="alert-field"><span>{label}</span>{children}</div>}
function AlertSelect({label,value,placeholder,options,onValueChange}:{label:string;value:string;placeholder?:string;options:Array<{value:string;label:string}>;onValueChange:(value:string)=>void}){return <Select value={value||undefined} onValueChange={onValueChange}><SelectTrigger aria-label={label} className="alert-select-trigger"><SelectValue placeholder={placeholder}/></SelectTrigger><SelectContent>{options.map(option=><SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>}
export function alertRecipientFromMember(member:JsonRecord){if(member.status&&member.status!=="active")return null;const user=member.user as JsonRecord|undefined;const id=String(user?.id??member.user_id??"");if(!id)return null;const name=String(user?.name??member.user_name??"").trim();const email=String(user?.email??member.email??"").trim();const phone=String(user?.phone??member.phone??"").trim();const label=name||email||phone||"—";const detail=[email,phone].find(value=>value&&value!==label)??"";return {id,label,detail}}
function ruleSummary(rule:AlertRule){if(rule.type==="device_offline")return `超过 ${Math.floor((rule.offline_after_seconds??0)/60)} 分钟无数据`;const condition=rule.condition_mode==="above"?`高于 ${rule.upper}`:rule.condition_mode==="below"?`低于 ${rule.lower}`:`超出 ${rule.lower}–${rule.upper}`;return `${rule.data_stream_name??"指标"} ${condition}${rule.unit??""}，持续 ${Math.floor(rule.duration_seconds/60)} 分钟`}
function rulePayload(rule:AlertRule,enabled:boolean):JsonRecord{return {name:rule.name,type:rule.type,severity:rule.severity,device_id:rule.device_id,data_stream_id:rule.data_stream_id,condition:{mode:rule.condition_mode,lower:rule.lower,upper:rule.upper,duration_seconds:rule.duration_seconds,recovery_delta:rule.recovery_delta},offline_after_seconds:rule.offline_after_seconds,recipient_user_ids:rule.recipient_user_ids,channels:rule.channels,enabled}}
