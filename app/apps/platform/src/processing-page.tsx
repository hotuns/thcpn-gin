import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PhotoSlider } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import { Activity, Archive, ArrowLeft, ChartNoAxesCombined, ChevronDown, CirclePause, CirclePlay, Eye, FileImage, ListTree, Plus, RefreshCw, Workflow, X } from "lucide-react";
import { api, formatApiError, type JsonRecord, type MediaItem, type ProcessingExecution, type ProcessingProcessor, type ProcessingResult, type ProcessingTask } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";
import { renderPhotoToolbar } from "./device-media";

const statusLabel: Record<string, string> = { active: "运行中", paused: "已暂停", archived: "已归档" };
const statusTone = (status: string) => status === "active" ? "success" : status === "paused" ? "warning" : "neutral";

export function ProcessingPage() {
  const { currentId } = useWorkspace();
  const navigate = useNavigate();
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
        <td><div className="cell-title">{task.target_name || (task.target_type === "device" ? "未命名设备" : "未命名站点")}</div><div className="cell-sub">{task.target_type === "device" ? "设备" : "站点"} · <span className="mono">{task.target_id}</span></div></td>
        <td>v{task.current_version}<div className="cell-sub">{task.last_execution_status ? `最近执行：${task.last_execution_status}` : "等待输入"}</div></td><td><Badge tone={statusTone(task.status) as any}>{statusLabel[task.status]}</Badge></td>
        <td><div className="table-actions"><Button variant="secondary" onClick={() => navigate(`/processing/${task.id}`)}><Eye size={14}/>查看</Button>{task.status === "active" ? <Button variant="secondary" onClick={() => void updateStatus(task, "paused")}><CirclePause size={14}/>暂停</Button> : task.status === "paused" ? <Button variant="secondary" onClick={() => void updateStatus(task, "active")}><CirclePlay size={14}/>启用</Button> : null}{task.status !== "archived" && <Button variant="secondary" onClick={() => window.confirm(`确认归档 ${task.name}？`) && void updateStatus(task, "archived")}><Archive size={14}/>归档</Button>}</div></td>
      </tr>)}</tbody></table></div>}
    </Panel>
    {creating && currentId && <CreateProcessingTask workspaceId={currentId} processors={processors.data?.items ?? []} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); setFeedback("处理任务已创建，Worker 将自动发现并处理输入数据"); await refresh(); }} />}
  </>;
}

const executionStatusLabel: Record<string, string> = { pending: "等待中", queued: "已排队", submitted: "已提交", running: "处理中", success: "成功", failed: "失败", superseded: "已替代" };
const executionTone = (status: string) => status === "success" ? "success" : status === "failed" ? "danger" : ["pending", "queued", "submitted", "running"].includes(status) ? "warning" : "neutral";
const displayTime = (input?: string) => input ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(input)) : "—";

export function ProcessingTaskDetailPage() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentId } = useWorkspace();
  const task = useQuery({ queryKey: workspaceQueryKey(currentId, "processing-task", taskId), queryFn: () => api.processing.get(currentId!, taskId), enabled: Boolean(currentId && taskId) });
  const executions = useQuery({ queryKey: workspaceQueryKey(currentId, "processing-executions", taskId), queryFn: () => api.processing.executions(currentId!, taskId), enabled: Boolean(currentId && taskId), refetchInterval: (query) => query.state.data?.items.some((item) => ["pending", "queued", "submitted", "running"].includes(item.status)) ? 3000 : false });
  const refresh = () => Promise.all([task.refetch(), executions.refetch()]);
  if (!currentId) return <Panel><StateView type="empty" title="请选择组织" description="请先选择组织，再查看处理任务。" /></Panel>;
  if (task.isLoading) return <Panel><StateView type="loading" title="正在加载处理任务" description="" /></Panel>;
  if (task.error) return <Panel><StateView type="error" title="处理任务加载失败" description={formatApiError(task.error).message} action={<Button variant="secondary" onClick={() => navigate("/processing")}><ArrowLeft size={14}/>返回</Button>} /></Panel>;
  const item = task.data!;
  const outputNames = new Map((item.outputs ?? []).map((output) => [output.code, output.name]));
  const executionItems = executions.data?.items ?? [];
  const successCount = executionItems.filter((execution) => execution.status === "success").length;
  const failedCount = executionItems.filter((execution) => execution.status === "failed").length;
  const activeView = searchParams.get("view") === "executions" ? "executions" : "results";
  const selectView = (view: "results" | "executions") => {
    const next = new URLSearchParams(searchParams);
    if (view === "results") next.delete("view"); else next.set("view", view);
    setSearchParams(next, { replace: true });
  };
  return <>
    <PageHeader eyebrow="数据 / 数据处理" title={item.name} description={item.description || "自动增量处理任务"} actions={<div className="header-actions"><Button variant="secondary" onClick={() => navigate("/processing")}><ArrowLeft size={14}/>返回</Button><Button variant="secondary" onClick={() => void refresh()}><RefreshCw size={14}/>刷新</Button></div>} />
    <div className="processing-detail-summary"><div><span>处理器</span><strong className="mono">{item.processor_code}@{item.processor_version}</strong></div><div><span>任务状态</span><Badge tone={statusTone(item.status) as any}>{statusLabel[item.status]}</Badge></div><div><span>处理起点</span><strong>{displayTime(item.start_at)}</strong></div><div><span>执行次数</span><strong>{executions.data?.items.length ?? "—"}</strong></div></div>
    <details className="panel section-gap processing-task-config"><summary className="processing-config-toggle"><div><strong>任务配置</strong><span>{item.target_name || item.target_id} · {(item.inputs ?? []).length} 个输入 · 每个输入触发</span></div><ChevronDown size={17}/></summary>
      <div className="processing-config-overview"><div><span>目标资源</span><strong>{item.target_name || item.target_id}</strong><small>{item.target_type === "device" ? "设备" : "站点"} · <span className="mono">{item.target_id}</span></small></div><div><span>处理器版本</span><strong>{item.processor_code}</strong><small className="mono">{item.processor_version}</small></div><div><span>触发方式</span><strong>{String(item.trigger?.mode ?? "each_input") === "each_input" ? "每个输入触发" : String(item.trigger?.mode)}</strong><small>任务版本 v{item.current_version}</small></div></div>
      <div className="processing-config-section"><h3>输入绑定</h3><div className="processing-config-inputs">{(item.inputs ?? []).map((input, index) => { const binding = input as JsonRecord; return <div key={String(binding.slot_code ?? index)}><div><strong>{String(binding.device_name || binding.source_name || "输入源")}</strong><span>{String(binding.source_name || binding.source_type || "")}</span></div><code>{String(binding.slot_code)} · {String(binding.source_id || binding.source_task_id || "—")}</code>{Object.keys((binding.config as JsonRecord | undefined) ?? {}).length > 0 && <pre>{JSON.stringify(binding.config, null, 2)}</pre>}</div>; })}</div></div>
      {Object.keys(item.config ?? {}).length > 0 && <div className="processing-config-section"><h3>处理参数</h3><pre className="processing-config-json">{JSON.stringify(item.config, null, 2)}</pre></div>}
    </details>
    <div className="processing-view-tabs" role="tablist" aria-label="数据处理视图"><button type="button" role="tab" aria-selected={activeView === "results"} onClick={() => selectView("results")}><ChartNoAxesCombined size={15}/>成果数据</button><button type="button" role="tab" aria-selected={activeView === "executions"} onClick={() => selectView("executions")}><ListTree size={15}/>执行记录{executionItems.length > 0 && <span>{executionItems.length}</span>}</button></div>
    {activeView === "results" ? <Panel className="processing-outcomes-panel"><div className="panel-header"><div><h2 className="panel-title">成果数据</h2><div className="panel-kicker">只展示成功执行产生的结构化数值，不与设备原始指标混合</div></div><ChartNoAxesCombined size={17}/></div>
      {executions.isLoading ? <StateView type="loading" title="正在加载成果数据" description="" /> : executions.error ? <StateView type="error" title="成果数据加载失败" description={formatApiError(executions.error).message} /> : <ProcessingResultsView executions={executionItems} outputNames={outputNames}/>}
    </Panel> : <Panel className="processing-executions-panel"><div className="panel-header"><div><h2 className="panel-title">执行记录</h2><div className="panel-kicker">{executionItems.length ? `${successCount} 次成功${failedCount ? ` · ${failedCount} 次失败` : ""}` : "最新记录显示在最前"}</div></div><Workflow size={17}/></div>
      {executions.isLoading ? <StateView type="loading" title="正在加载执行记录" description="" /> : executions.error ? <StateView type="error" title="执行记录加载失败" description={formatApiError(executions.error).message} /> : !executions.data?.items.length ? <StateView type="empty" title="暂无执行记录" description="任务获得符合条件的输入后，执行记录会显示在这里。" /> : <div className="processing-execution-list">{executions.data.items.map((execution, index) => <ExecutionRow key={execution.id} execution={execution} outputNames={outputNames} initiallyOpen={index === 0} />)}</div>}
    </Panel>}
  </>;
}

type ProcessingMetricPoint = { executionId: string; code: string; name: string; value: number; unit: string; observedAt: string; timestamp: number };

function ProcessingResultsView({ executions, outputNames }: { executions: ProcessingExecution[]; outputNames: Map<string, string> }) {
  const points = useMemo<ProcessingMetricPoint[]>(() => executions.flatMap((execution) => execution.status !== "success" ? [] : execution.results.flatMap((result) => {
    if (result.kind !== "metric" || result.numeric_value == null) return [];
    const observedAt = result.observed_at ?? execution.observed_at ?? execution.created_at;
    return [{ executionId: execution.id, code: result.output_code, name: outputNames.get(result.output_code) ?? result.output_code, value: result.numeric_value, unit: result.unit ?? "", observedAt, timestamp: new Date(observedAt).getTime() }];
  })).sort((a, b) => a.timestamp - b.timestamp), [executions, outputNames]);
  const metrics = useMemo(() => Array.from(new Map(points.map((point) => [point.code, { code: point.code, name: point.name, unit: point.unit }])).values()), [points]);
  const [selectedCode, setSelectedCode] = useState("");
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const mediaSectionRef = useRef<HTMLElement>(null);
  useEffect(() => { if (!metrics.some((metric) => metric.code === selectedCode)) setSelectedCode(metrics[0]?.code ?? ""); }, [metrics, selectedCode]);
  const selected = metrics.find((metric) => metric.code === selectedCode) ?? metrics[0];
  const selectedPoints = points.filter((point) => point.code === selected?.code);
  const latest = selectedPoints.at(-1);
  useEffect(() => {
    if (!selectedPoints.some((point) => point.executionId === selectedExecutionId)) setSelectedExecutionId(latest?.executionId ?? "");
  }, [latest?.executionId, selectedExecutionId, selectedPoints]);
  const selectedPoint = selectedPoints.find((point) => point.executionId === selectedExecutionId) ?? latest;
  const selectedExecution = executions.find((execution) => execution.id === selectedPoint?.executionId);
  const selectedInputs = selectedExecution?.inputs?.filter((input) => input.url) ?? [];
  const selectedArtifacts = selectedExecution?.results.filter((result) => result.kind === "artifact" && result.url) ?? [];
  const selectExecution = (executionId: string) => {
    setSelectedExecutionId(executionId);
    requestAnimationFrame(() => mediaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const selectNearestChartPoint = (clientX: number, chart: HTMLDivElement) => {
    const dots = Array.from(chart.querySelectorAll<SVGGElement>(".processing-outcome-dot-hit"));
    const nearestIndex = dots.reduce((nearest, dot, index) => {
      const bounds = dot.getBoundingClientRect();
      const distance = Math.abs(clientX - (bounds.left + bounds.width / 2));
      return distance < nearest.distance ? { index, distance } : nearest;
    }, { index: -1, distance: Number.POSITIVE_INFINITY }).index;
    const point = selectedPoints[nearestIndex];
    if (point) selectExecution(point.executionId);
  };
  if (!points.length) return <StateView type="empty" title="暂无数值成果" description="任务成功输出数值指标后，会在这里形成独立的成果时间序列。" />;
  return <div className="processing-outcomes">
    <div className="processing-outcome-toolbar"><label><span>成果指标</span><select value={selected?.code ?? ""} onChange={(event) => setSelectedCode(event.target.value)}>{metrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}{metric.unit ? ` · ${metric.unit}` : ""}</option>)}</select></label><div className="processing-outcome-summary"><div><span>最新值</span><strong>{latest?.value.toLocaleString(document.documentElement.lang || "zh-CN")}<small>{selected?.unit}</small></strong></div><div><span>成果数量</span><strong>{selectedPoints.length}<small>条</small></strong></div><div><span>时间范围</span><strong>{selectedPoints.length > 1 ? `${displayOutcomeDate(selectedPoints[0].observedAt)} - ${displayOutcomeDate(latest?.observedAt)}` : displayOutcomeDate(latest?.observedAt)}</strong></div></div></div>
    <div className="processing-outcome-chart-head"><span>成果趋势</span><small>悬停查看吸附点，点击选中并查看关联图像</small></div>
    <div className="processing-outcome-chart" aria-label={`${selected?.name ?? "成果"}趋势图`} onMouseDownCapture={(event) => { if (event.button === 0) event.preventDefault(); }} onClickCapture={(event) => { if (event.button === 0) selectNearestChartPoint(event.clientX, event.currentTarget); }}><ResponsiveContainer width="100%" height="100%"><LineChart data={selectedPoints} margin={{ top: 18, right: 24, bottom: 8, left: 0 }}><CartesianGrid stroke="var(--soft-line)" vertical={false}/><XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value) => displayOutcomeDate(new Date(Number(value)).toISOString())} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false}/><YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={52}/><Tooltip formatter={(value) => [Number(value).toLocaleString(document.documentElement.lang || "zh-CN"), selected?.name ?? "成果值"]} labelFormatter={(value) => displayTime(new Date(Number(value)).toISOString())}/><Line dataKey="value" name={selected?.name} stroke="var(--blue)" strokeWidth={2} dot={(props: any) => { const point = props.payload as ProcessingMetricPoint; const active = point.executionId === selectedPoint?.executionId; return <g className="processing-outcome-dot-hit"><circle cx={props.cx} cy={props.cy} r={18} fill="transparent" stroke="transparent"/><circle cx={props.cx} cy={props.cy} r={active ? 5 : 4} fill={active ? "var(--blue)" : "var(--panel)"} stroke="var(--blue)" strokeWidth={2} className="processing-outcome-dot"/></g>; }} activeDot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>
    <section ref={mediaSectionRef} className="processing-outcome-media">
      <div className="processing-outcome-media-head"><div><span>关联图像</span><strong>{displayTime(selectedPoint?.observedAt)}</strong></div><div><strong>{selectedPoint?.value.toLocaleString(document.documentElement.lang || "zh-CN")}<small>{selectedPoint?.unit}</small></strong><span>{selectedInputs.length} 张输入 · {selectedArtifacts.length} 张处理结果</span></div></div>
      {selectedInputs.length || selectedArtifacts.length ? <div className="processing-outcome-media-grid">{selectedInputs.map((input) => <ResultArtwork key={`${selectedExecution?.id}-${input.slot_code}`} url={input.url} eyebrow="输入图像" name={input.slot_code || "输入"}/>)}{selectedArtifacts.map((result) => <ResultArtwork key={result.id} url={result.url} eyebrow="处理结果" name={outputNames.get(result.output_code) ?? result.output_code}/>)}</div> : <StateView type="empty" title="该成果没有关联图像" description="当前执行只产生了数值成果。" />}
    </section>
  </div>;
}

const displayOutcomeDate = (input?: string) => input ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(input)) : "—";

function ExecutionRow({ execution, outputNames, initiallyOpen }: { execution: ProcessingExecution; outputNames: Map<string, string>; initiallyOpen: boolean }) {
  const executionInputs = Array.isArray(execution.inputs) ? execution.inputs : [];
  const metrics = execution.results.filter((result) => result.kind === "metric");
  const artifacts = execution.results.filter((result) => result.kind === "artifact");
  const records = execution.results.filter((result) => result.kind === "record");
  const hasResults = execution.results.length > 0;
  return <details className={`processing-execution is-${execution.status}`} open={initiallyOpen}><summary><div className="processing-execution-main"><Badge tone={executionTone(execution.status) as any}>{executionStatusLabel[execution.status] ?? execution.status}</Badge><div><strong>{displayTime(execution.observed_at ?? execution.created_at)}</strong><span>{execution.status === "success" ? `${execution.results.length} 项结果` : execution.error_message || "等待处理结果"}</span></div></div><div className="processing-execution-meta"><span className="mono">v{execution.task_version}</span><span>{execution.finished_at ? displayTime(execution.finished_at) : "尚未完成"}</span><ChevronDown size={16}/></div></summary>{execution.error_message && <div className="processing-execution-error"><strong>执行失败</strong><span>{execution.error_message}</span></div>}{hasResults && <div className={`processing-result-layout ${artifacts.length || executionInputs.some((input) => input.url) ? "has-visuals" : "no-visuals"}`}><div className="processing-result-visuals">{executionInputs.filter((input) => input.url).map((input) => <ResultArtwork key={`${execution.id}-${input.slot_code}`} url={input.url!} eyebrow="输入图像" name={input.slot_code || "输入"}/>) }{artifacts.map((result) => <ResultArtwork key={result.id} url={result.url} eyebrow="处理结果" name={outputNames.get(result.output_code) ?? result.output_code}/>)}</div><aside className="processing-result-sidebar"><div className="processing-metric-list">{metrics.map((result) => <ResultValue key={result.id} result={result} name={outputNames.get(result.output_code) ?? result.output_code} />)}</div>{records.map((result) => <ResultValue key={result.id} result={result} name={outputNames.get(result.output_code) ?? result.output_code} />)}<div className="processing-result-source mono">{execution.input_key}</div></aside></div>}</details>;
}

function ResultValue({ result, name }: { result: ProcessingResult; name: string }) {
  if (result.kind === "metric") return <div className="processing-result processing-result-metric"><span>{name}</span><strong>{result.numeric_value?.toLocaleString(document.documentElement.lang || "zh-CN") ?? "—"}<small>{result.unit ?? ""}</small></strong><code>{result.output_code}</code></div>;
  return <details className="processing-result processing-result-record"><summary><span>{name}</span><span>查看详情</span></summary><dl>{Object.entries(result.record ?? {}).map(([key, value]) => <div key={key}><dt>{recordFieldLabel(key)}</dt><dd>{String(value)}</dd></div>)}</dl><code>{result.output_code}</code></details>;
}

function ResultArtwork({ url, eyebrow, name }: { url?: string; eyebrow: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const download = () => {
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    anchor.click();
  };
  return <>
    <div className="processing-result-artwork">
      <div className="processing-result-artwork-head">
        <div><span>{eyebrow}</span><strong>{name}</strong></div>
        {url && !failed && <button type="button" className="processing-result-preview" onClick={() => setPreviewOpen(true)} title="全屏预览"><Eye size={15}/><span>查看原图</span></button>}
      </div>
      <div className="processing-result-image">{url && !failed ? <img src={url} alt={name} onError={() => setFailed(true)}/> : <div><FileImage size={24}/><span>图像暂不可用</span></div>}</div>
    </div>
    <PhotoSlider
      visible={previewOpen}
      onClose={() => setPreviewOpen(false)}
      photoWrapClassName="thcpn-photo-wrap"
      index={0}
      images={url ? [{ key: `${eyebrow}-${name}`, src: url, overlay: <div className="photo-preview-caption"><strong>{name}</strong><span>{eyebrow}</span></div> }] : []}
      toolbarRender={(props) => renderPhotoToolbar({ ...props, onDownload: download })}
    />
  </>;
}

const recordLabels: Record<string, string> = { method: "识别方法", threshold: "判定阈值", total_pixels: "总像素", vegetation_pixels: "植物像素" };
const recordFieldLabel = (key: string) => recordLabels[key] ?? key.replaceAll("_", " ");

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
  const [sourceConfigs, setSourceConfigs] = useState<Record<string,JsonRecord>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const devices = useQuery({ queryKey: workspaceQueryKey(workspaceId, "devices"), queryFn: () => api.devices.list(workspaceId) });
  const sites = useQuery({ queryKey: workspaceQueryKey(workspaceId, "sites"), queryFn: () => api.sites.list(workspaceId) });
  const selected = useMemo(() => processors.find((item) => `${item.code}@${item.version}` === processorKey), [processors, processorKey]);
  const slots = selected?.manifest.inputs ?? [];
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => { if (targetType === "device" && targetId) setSourceDevices(Object.fromEntries(slots.map((slot) => [slot.code, targetId]))); }, [targetId, targetType, processorKey]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || !targetId) return;
    setBusy(true); setError("");
    try {
      await api.processing.create(workspaceId, { name, description, target_type: targetType, target_id: targetId, processor_code: selected.code, processor_version: selected.version, config: {}, trigger: { mode: "each_input" }, start_at: startMode === "now" ? new Date().toISOString() : new Date(startAt).toISOString(), inputs: slots.map((slot) => ({ slot_code: slot.code, source_type: "data_stream", source_id: sourceStreams[slot.code], config: sourceConfigs[slot.code] ?? {} })) });
      await onCreated();
    } catch (value) { setError(formatApiError(value).message); } finally { setBusy(false); }
  };
  return <div className="processing-dialog"><form className="processing-editor" role="dialog" aria-modal="true" aria-label="创建处理任务" onSubmit={submit}>
    <div className="panel-header"><div><h2 className="panel-title">创建处理任务</h2><div className="panel-kicker">选择目标、处理器和每个输入槽的数据流</div></div><Button type="button" variant="secondary" onClick={onClose}><X size={14}/>关闭</Button></div>
    <div className="processing-form"><div className="processing-form-main"><div className="form-grid two"><label className="field"><span className="field-label">任务名称</span><input required value={name} onChange={(e) => setName(e.target.value)}/></label><label className="field"><span className="field-label">处理器</span><select required value={processorKey} onChange={(e) => setProcessorKey(e.target.value)}>{processors.filter((item) => item.enabled).map((item) => <option key={`${item.code}@${item.version}`} value={`${item.code}@${item.version}`}>{item.name} · {item.version}</option>)}</select></label></div>
    <label className="field"><span className="field-label">说明</span><input value={description} onChange={(e) => setDescription(e.target.value)}/></label>
    <div className="form-grid two"><label className="field"><span className="field-label">结果目标</span><select value={targetType} onChange={(e) => { setTargetType(e.target.value as any); setTargetId(""); }}><option value="device">设备</option><option value="site">站点</option></select></label><label className="field"><span className="field-label">目标资源</span><select required value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">请选择</option>{(targetType === "device" ? devices.data?.items : sites.data?.items)?.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <div className="processing-inputs"><div className="section-label">输入绑定</div>{slots.map((slot) => <InputBinding key={slot.code} slot={slot} devices={devices.data?.items ?? []} deviceId={sourceDevices[slot.code] ?? ""} streamId={sourceStreams[slot.code] ?? ""} config={sourceConfigs[slot.code] ?? {}} onDevice={(value) => setSourceDevices((current) => ({...current, [slot.code]: value}))} onStream={(value) => { setSourceStreams((current) => ({...current, [slot.code]: value})); setSourceConfigs((current) => ({...current, [slot.code]: {}})); }} onConfig={(value) => setSourceConfigs((current) => ({...current, [slot.code]: value}))}/>)}</div></div>
    <aside className="processing-form-side">
    <div className="form-grid two"><label className="field"><span className="field-label">处理起点</span><select value={startMode} onChange={(e) => setStartMode(e.target.value)}><option value="now">从现在开始</option><option value="history">从指定时间开始</option></select></label>{startMode === "history" && <label className="field"><span className="field-label">开始时间</span><input required type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}/></label>}</div>
    {selected && <div className="processor-contract"><Activity size={15}/><div><strong>{selected.name}</strong><span>{selected.description}</span><small>输出：{(selected.manifest.outputs ?? []).map((item) => item.name).join("、")}</small></div></div>}
    {error && <div className="form-error">{error}</div>}<div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !name || !targetId || slots.some((slot) => !sourceStreams[slot.code] || (slot.ui?.calibration_board?.required && !sourceConfigs[slot.code]?.calibration_board))}>{busy ? "创建中…" : "创建任务"}</Button></div></aside></div>
  </form></div>;
}

type InputSlot = NonNullable<ProcessingProcessor["manifest"]["inputs"]>[number];
type CalibrationBoard = { shape: "rectangle"; x: number; y: number; width: number; height: number; reference_media_id: string; reference_width: number; reference_height: number };

function InputBinding({ slot, devices, deviceId, streamId, config, onDevice, onStream, onConfig }: { slot: InputSlot; devices: any[]; deviceId:string;streamId:string;config:JsonRecord;onDevice:(value:string)=>void;onStream:(value:string)=>void;onConfig:(value:JsonRecord)=>void }) {
  const streams = useQuery({ queryKey: ["data-streams", deviceId], queryFn: () => api.dataStreams.list(deviceId), enabled: Boolean(deviceId) });
  return <div className="processing-input-binding"><div className="processing-input-row"><div><strong>{slot.name}</strong><span className="mono">{slot.code} · {slot.kind}</span></div><select required value={deviceId} onChange={(e) => {onDevice(e.target.value);onStream("");}}><option value="">选择设备</option>{devices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select required value={streamId} onChange={(e) => onStream(e.target.value)}><option value="">选择数据流</option>{streams.data?.items.filter((item) => item.type === "image").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>{slot.ui?.calibration_board && streamId ? <CalibrationBoardPicker streamId={streamId} label={slot.ui.calibration_board.label ?? "标定板"} value={config.calibration_board as CalibrationBoard | undefined} onChange={(value) => onConfig({...config, calibration_board: value})} /> : null}</div>;
}

function CalibrationBoardPicker({ streamId, label, value, onChange }: { streamId: string; label: string; value?: CalibrationBoard; onChange: (value: CalibrationBoard) => void }) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);
  const media = useQuery({ queryKey: ["processing", "calibration-image", streamId], queryFn: () => api.media.dataStream(streamId, { start_time: startTime.toISOString(), end_time: endTime.toISOString(), page: 1, page_size: 1 }), enabled: Boolean(streamId) });
  const image = media.data?.items[0] as MediaItem | undefined;
  if (media.isLoading) return <div className="processing-calibration-state">正在加载最近图片…</div>;
  if (media.error) return <div className="processing-calibration-state is-error">图片加载失败：{formatApiError(media.error).message}</div>;
  if (!image) return <div className="processing-calibration-state">最近 30 天没有可用于框选的图片</div>;
  return <CalibrationCanvas key={`${streamId}:${image.id}`} image={image} label={label} value={value} onChange={onChange} />;
}

function CalibrationCanvas({ image, label, value, onChange }: { image: MediaItem; label: string; value?: CalibrationBoard; onChange: (value: CalibrationBoard) => void }) {
  const [start, setStart] = useState<{x:number;y:number}|null>(null);
  const [rect, setRect] = useState(value ? {x:value.x,y:value.y,width:value.width,height:value.height} : null);
  const [size, setSize] = useState({width:value?.reference_width ?? 0,height:value?.reference_height ?? 0});
  const point = (event: ReactPointerEvent<HTMLDivElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); return {x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))}; };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => { if (!start) return; const current=point(event); setRect({x:Math.min(start.x,current.x),y:Math.min(start.y,current.y),width:Math.abs(current.x-start.x),height:Math.abs(current.y-start.y)}); };
  const finish = () => { if (rect && rect.width >= .005 && rect.height >= .005) onChange({shape:"rectangle",...rect,reference_media_id:image.id,reference_width:size.width,reference_height:size.height}); setStart(null); };
  return <div className="processing-calibration"><div className="processing-calibration-head"><div><strong>{label}</strong><span>参考图像 · 矩形区域</span></div>{value ? <Badge tone="success">已框选</Badge> : <Badge tone="warning">需要框选</Badge>}</div><div className="processing-calibration-stage" style={size.width && size.height ? {aspectRatio:`${size.width} / ${size.height}`} : undefined} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const next=point(event); setStart(next); setRect({x:next.x,y:next.y,width:0,height:0}); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => setStart(null)}><img src={image.preview_url} alt={`${label}参考图片`} draggable={false} onLoad={(event) => setSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}/>{rect && <div className="processing-calibration-rect" style={{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.width*100}%`,height:`${rect.height*100}%`}}><span>{label}</span></div>}</div><div className="processing-calibration-foot"><span>{displayTime(image.captured_at)}</span>{value ? <code>x {value.x.toFixed(3)} · y {value.y.toFixed(3)} · w {value.width.toFixed(3)} · h {value.height.toFixed(3)}</code> : <span>尚未设置区域</span>}</div></div>;
}
