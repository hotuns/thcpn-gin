import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Archive, CirclePause, CirclePlay, Plus, Workflow, X } from "lucide-react";
import { api, formatApiError, type JsonRecord, type ProcessingProcessor, type ProcessingTask } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";

const statusLabel: Record<string, string> = { active: "运行中", paused: "已暂停", archived: "已归档" };
const statusTone = (status: string) => status === "active" ? "success" : status === "paused" ? "warning" : "neutral";

export function ProcessingPage() {
  const { currentId } = useWorkspace();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState("");
  const processors = useQuery({ queryKey: ["processing", "processors"], queryFn: api.processing.processors });
  const tasks = useQuery({ queryKey: workspaceQueryKey(currentId, "processing-tasks"), queryFn: () => api.processing.list(currentId!), enabled: Boolean(currentId) });
  const refresh = () => client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "processing-tasks") });
  const updateStatus = async (task: ProcessingTask, status: string) => {
    if (!currentId) return;
    setFeedback("");
    try { await api.processing.status(currentId, task.id, status); await refresh(); }
    catch (error) { setFeedback(formatApiError(error).message); }
  };
  return <>
    <PageHeader eyebrow="数据" title="数据处理" description="配置系统内置处理器，将设备数据转为可追溯的派生指标和文件。" actions={<Button onClick={() => setCreating(true)}><Plus size={15}/>创建处理任务</Button>} />
    {feedback && <div className="command-note">{feedback}</div>}
    <div className="processing-summary">
      <div><strong>{tasks.data?.items.filter((item) => item.status === "active").length ?? "—"}</strong><span>运行中</span></div>
      <div><strong>{processors.data?.items.filter((item) => item.enabled).length ?? "—"}</strong><span>可用处理器</span></div>
      <div><strong>{tasks.data?.items.length ?? "—"}</strong><span>全部任务</span></div>
    </div>
    <Panel className="section-gap">
      <div className="panel-header"><div><h2 className="panel-title">处理任务</h2><div className="panel-kicker">任务关键配置按版本保存，归档后仍保留历史结果</div></div><Workflow size={17}/></div>
      {tasks.isLoading ? <StateView type="loading" title="正在加载处理任务" description="" /> : tasks.isError ? <StateView type="error" title="处理任务加载失败" description={formatApiError(tasks.error).message} /> : !tasks.data?.items.length ? <StateView type="empty" title="暂无处理任务" description="创建任务后，系统会从指定起点自动处理新增数据。" /> :
      <div className="table-wrap"><table className="data-table"><thead><tr><th>任务</th><th>处理器</th><th>目标</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>{tasks.data.items.map((task) => <tr key={task.id}>
        <td><div className="cell-title">{task.name}</div><div className="cell-sub">{task.description || "自动增量处理"}</div></td>
        <td><div className="cell-title mono">{task.processor_code}@{task.processor_version}</div></td>
        <td>{task.target_type === "device" ? "设备" : "站点"}<div className="cell-sub mono">{task.target_id}</div></td>
        <td>v{task.current_version}<div className="cell-sub">{task.last_execution_status ? `最近执行：${task.last_execution_status}` : "等待输入"}</div></td><td><Badge tone={statusTone(task.status) as any}>{statusLabel[task.status]}</Badge></td>
        <td><div className="table-actions">{task.status === "active" ? <Button variant="secondary" onClick={() => void updateStatus(task, "paused")}><CirclePause size={14}/>暂停</Button> : task.status === "paused" ? <Button variant="secondary" onClick={() => void updateStatus(task, "active")}><CirclePlay size={14}/>启用</Button> : null}{task.status !== "archived" && <Button variant="secondary" onClick={() => window.confirm(`确认归档 ${task.name}？`) && void updateStatus(task, "archived")}><Archive size={14}/>归档</Button>}</div></td>
      </tr>)}</tbody></table></div>}
    </Panel>
    {creating && currentId && <CreateProcessingTask workspaceId={currentId} processors={processors.data?.items ?? []} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); setFeedback("处理任务已创建，Worker 将自动发现并处理输入数据"); await refresh(); }} />}
  </>;
}

function CreateProcessingTask({ workspaceId, processors, onClose, onCreated }: { workspaceId: string; processors: ProcessingProcessor[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [processorKey, setProcessorKey] = useState(processors[0] ? `${processors[0].code}@${processors[0].version}` : "");
  const [targetType, setTargetType] = useState<"device"|"site">("device");
  const [targetId, setTargetId] = useState("");
  const [startMode, setStartMode] = useState("now");
  const [startAt, setStartAt] = useState("");
  const [sourceDevices, setSourceDevices] = useState<Record<string,string>>({});
  const [sourceStreams, setSourceStreams] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const devices = useQuery({ queryKey: workspaceQueryKey(workspaceId, "devices"), queryFn: () => api.devices.list(workspaceId) });
  const sites = useQuery({ queryKey: workspaceQueryKey(workspaceId, "sites"), queryFn: () => api.sites.list(workspaceId) });
  const selected = useMemo(() => processors.find((item) => `${item.code}@${item.version}` === processorKey), [processors, processorKey]);
  const slots = selected?.manifest.inputs ?? [];
  useEffect(() => { if (targetType === "device" && targetId) setSourceDevices(Object.fromEntries(slots.map((slot) => [slot.code, targetId]))); }, [targetId, targetType, processorKey]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || !targetId) return;
    setBusy(true); setError("");
    try {
      await api.processing.create(workspaceId, { name, description, target_type: targetType, target_id: targetId, processor_code: selected.code, processor_version: selected.version, config: {}, trigger: { mode: "each_input" }, start_at: startMode === "now" ? new Date().toISOString() : new Date(startAt).toISOString(), inputs: slots.map((slot) => ({ slot_code: slot.code, source_type: "data_stream", source_id: sourceStreams[slot.code], config: {} })) });
      await onCreated();
    } catch (value) { setError(formatApiError(value).message); } finally { setBusy(false); }
  };
  return <div className="processing-dialog" role="dialog" aria-modal="true"><button className="access-drawer-backdrop" aria-label="关闭" onClick={onClose}/><form className="processing-editor" onSubmit={submit}>
    <div className="panel-header"><div><h2 className="panel-title">创建处理任务</h2><div className="panel-kicker">选择目标、处理器和每个输入槽的数据流</div></div><Button type="button" variant="secondary" onClick={onClose}><X size={14}/>关闭</Button></div>
    <div className="processing-form"><div className="form-grid two"><label className="field"><span className="field-label">任务名称</span><input required value={name} onChange={(e) => setName(e.target.value)}/></label><label className="field"><span className="field-label">处理器</span><select required value={processorKey} onChange={(e) => setProcessorKey(e.target.value)}>{processors.filter((item) => item.enabled).map((item) => <option key={`${item.code}@${item.version}`} value={`${item.code}@${item.version}`}>{item.name} · {item.version}</option>)}</select></label></div>
    <label className="field"><span className="field-label">说明</span><input value={description} onChange={(e) => setDescription(e.target.value)}/></label>
    <div className="form-grid two"><label className="field"><span className="field-label">结果目标</span><select value={targetType} onChange={(e) => { setTargetType(e.target.value as any); setTargetId(""); }}><option value="device">设备</option><option value="site">站点</option></select></label><label className="field"><span className="field-label">目标资源</span><select required value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">请选择</option>{(targetType === "device" ? devices.data?.items : sites.data?.items)?.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <div className="processing-inputs"><div className="section-label">输入绑定</div>{slots.map((slot) => <InputBinding key={slot.code} slot={slot} devices={devices.data?.items ?? []} deviceId={sourceDevices[slot.code] ?? ""} streamId={sourceStreams[slot.code] ?? ""} onDevice={(value) => setSourceDevices((current) => ({...current, [slot.code]: value}))} onStream={(value) => setSourceStreams((current) => ({...current, [slot.code]: value}))}/>)}</div>
    <div className="form-grid two"><label className="field"><span className="field-label">处理起点</span><select value={startMode} onChange={(e) => setStartMode(e.target.value)}><option value="now">从现在开始</option><option value="history">从指定时间开始</option></select></label>{startMode === "history" && <label className="field"><span className="field-label">开始时间</span><input required type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}/></label>}</div>
    {selected && <div className="processor-contract"><Activity size={15}/><div><strong>{selected.name}</strong><span>{selected.description}</span><small>输出：{(selected.manifest.outputs ?? []).map((item) => item.name).join("、")}</small></div></div>}
    {error && <div className="form-error">{error}</div>}<div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !name || !targetId || slots.some((slot) => !sourceStreams[slot.code])}>{busy ? "创建中…" : "创建任务"}</Button></div></div>
  </form></div>;
}

function InputBinding({ slot, devices, deviceId, streamId, onDevice, onStream }: { slot: {code:string;name:string;kind:string}; devices: any[]; deviceId:string;streamId:string;onDevice:(value:string)=>void;onStream:(value:string)=>void }) {
  const streams = useQuery({ queryKey: ["data-streams", deviceId], queryFn: () => api.dataStreams.list(deviceId), enabled: Boolean(deviceId) });
  return <div className="processing-input-row"><div><strong>{slot.name}</strong><span className="mono">{slot.code} · {slot.kind}</span></div><select required value={deviceId} onChange={(e) => {onDevice(e.target.value);onStream("");}}><option value="">选择设备</option>{devices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select required value={streamId} onChange={(e) => onStream(e.target.value)}><option value="">选择数据流</option>{streams.data?.items.filter((item) => item.type === "image").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>;
}
