import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Activity, Archive, Battery, Eye, Image as ImageIcon, MapPinOff, Maximize2, MonitorUp, Plus, Radio, RefreshCw, Signal, TriangleAlert, X } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, formatApiError, type DataStream, type Wallboard, type WallboardSnapshot, type WallboardTemplate } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, CloseButton, PageHeader, Panel, SelectInput, StateView, TextInput } from "@thcpn/ui";
import { WallboardCesiumMap } from "./wallboard-cesium-map";
import { DeviceCombobox } from "./device-combobox";
import "./wallboards-modern.css";

export function WallboardsPage() {
  const { currentId } = useWorkspace();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [selected, setSelected] = useState<WallboardTemplate | null>(null);
  const [preview, setPreview] = useState<WallboardTemplate | null>(null);
  const [editing, setEditing] = useState<Wallboard | null>(null);
  const [message, setMessage] = useState("");
  const templates = useQuery({ queryKey: ["wallboard-templates"], queryFn: api.wallboards.templates });
  const boards = useQuery({ queryKey: workspaceQueryKey(currentId, "wallboards"), queryFn: () => api.wallboards.list(currentId!), enabled: Boolean(currentId) });
  const boardItems = boards.data?.items ?? [];
  const refresh = () => client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "wallboards") });
  const archive = async (item: Wallboard) => { if (!currentId || !window.confirm(`确认归档“${item.name}”？`)) return; try { await api.wallboards.archive(currentId, item.id); await refresh(); } catch (error) { setMessage(formatApiError(error).message); } };
  return <>
    <PageHeader eyebrow="展示" title="大屏展示" description="从模板创建组织大屏，绑定站点、设备和数据后进入全屏播放。" actions={<Button onClick={() => document.getElementById("wallboard-catalog")?.scrollIntoView({ behavior: "smooth" })}><Plus size={15}/>创建大屏</Button>} />
    {message && <div className="command-note">{message}</div>}
    <Panel><div className="panel-header"><div><h2 className="panel-title">我的大屏</h2><div className="panel-kicker">大屏配置和模板版本在创建时冻结</div></div><MonitorUp size={18}/></div>
      {boards.isLoading ? <StateView type="loading" title="正在加载大屏" description=""/> : boards.isError ? <StateView type="error" title="大屏加载失败" description={formatApiError(boards.error).message}/> : !boardItems.filter((item) => item.status === "active").length ? <StateView type="empty" title="还没有大屏" description="从下方模板目录选择一个免费模板开始配置。"/> : <div className="wallboard-list">{boardItems.filter((item) => item.status === "active").map((item) => <article key={item.id} className="wallboard-instance-card"><div className="wallboard-cover wallboard-cover-device"><MonitorUp size={30}/></div><div><Badge tone="info">{item.template_name}</Badge><h3>{item.name}</h3><p>模板 v{item.template_version} · 更新于 {new Date(item.updated_at).toLocaleString()}</p></div><div className="wallboard-card-actions"><Button variant="secondary" onClick={() => setEditing(item)}>编辑</Button><Button variant="secondary" onClick={() => navigate(`/wallboards/${item.id}/play?preview=1`)}><Eye size={14}/>预览</Button><Button onClick={() => navigate(`/wallboards/${item.id}/play`)}><Maximize2 size={14}/>播放</Button><Button variant="secondary" onClick={() => void archive(item)}><Archive size={14}/>归档</Button></div></article>)}</div>}
    </Panel>
    <section id="wallboard-catalog" className="section-gap"><div className="section-heading"><div><span>模板目录</span><h2>选择展示方式</h2></div></div>{templates.isLoading ? <StateView type="loading" title="正在加载模板" description=""/> : templates.isError ? <StateView type="error" title="模板加载失败" description={formatApiError(templates.error).message}/> : <div className="wallboard-template-grid">{templates.data?.items.map((item) => <article className={`wallboard-template-card wallboard-cover-${item.cover}`} key={item.code}><div className="wallboard-template-preview"><TemplateBackdrop kind={item.cover}/><Badge tone={item.tier === "free" ? "success" : "warning"}>{item.tier === "free" ? "免费模板" : item.display_price || "高级模板"}</Badge></div><div className="wallboard-template-copy"><h3>{item.name}</h3><p>{item.description}</p><div><Button variant="secondary" onClick={() => setPreview(item)}><Eye size={14}/>示例预览</Button>{item.can_create ? <Button onClick={() => setSelected(item)}>使用模板</Button> : <Button variant="secondary" disabled>{item.contact_copy || "联系开通"}</Button>}</div></div></article>)}</div>}</section>
    {(selected || editing) && currentId && <WallboardEditor workspaceId={currentId} template={selected ?? templates.data?.items.find((item) => item.code === editing?.template_code) ?? null} wallboard={editing} onClose={() => { setSelected(null); setEditing(null); }} onSaved={async (item) => { setSelected(null); setEditing(null); await refresh(); navigate(`/wallboards/${item.id}/play?preview=1`); }}/>} 
    {preview && <TemplatePreview template={preview} onClose={() => setPreview(null)}/>} 
  </>;
}

function TemplateBackdrop({ kind }: { kind: string }) { return <div className="wallboard-mini-layout"><span/><span/><span/><span className={kind === "organization" ? "wide" : ""}/></div>; }

function TemplatePreview({ template, onClose }: { template: WallboardTemplate; onClose: () => void }) {
  const query = useQuery({ queryKey: ["wallboard-preview", template.code], queryFn: () => api.wallboards.preview(template.code) });
  return <div className="wallboard-preview-layer"><div className="wallboard-preview-shell"><CloseButton onClick={onClose}/>{query.isLoading ? <StateView type="loading" title="正在生成示例预览" description=""/> : query.isError ? <StateView type="error" title="预览加载失败" description={formatApiError(query.error).message}/> : <WallboardCanvas template={template} snapshot={query.data!.snapshot}/>}<div className="wallboard-preview-footer"><strong>{template.name}</strong><span>{template.tier === "premium" ? `${template.display_price || "高级模板"} · ${template.contact_copy}` : "示例数据预览"}</span></div></div></div>;
}

function WallboardEditor({ workspaceId, template, wallboard, onClose, onSaved }: { workspaceId: string; template: WallboardTemplate | null; wallboard: Wallboard | null; onClose: () => void; onSaved: (item: Wallboard) => void }) {
  const [name, setName] = useState(wallboard?.name ?? template?.name ?? "");
  const [deviceId, setDeviceId] = useState(wallboard?.config.device_id ?? "");
  const [deviceIds, setDeviceIds] = useState<string[]>(wallboard?.config.device_ids ?? []);
  const [trendHours, setTrendHours] = useState(String(wallboard?.config.trend_hours ?? 24));
  const [telemetryIds, setTelemetryIds] = useState<string[]>(wallboard?.config.telemetry_stream_ids ?? []);
  const [comparisonStream, setComparisonStream] = useState(wallboard?.config.comparison_stream ?? "");
  const [imageIds, setImageIds] = useState<string[]>(wallboard?.config.image_stream_ids ?? []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const devices = useQuery({ queryKey: workspaceQueryKey(workspaceId, "devices"), queryFn: () => api.devices.list(workspaceId) });
  const selectedDeviceIds = template?.scene === "organization" && deviceIds.length ? deviceIds : deviceId ? [deviceId] : (devices.data?.items.map((d) => d.id) ?? []);
  const streams = useQuery({ queryKey: ["wallboard-streams", ...selectedDeviceIds], queryFn: async () => ({ items: (await Promise.all(selectedDeviceIds.map(api.dataStreams.list))).flatMap((r) => r.items) }), enabled: selectedDeviceIds.length > 0 });
  if (!template) return null;
  const toggle = (id: string, values: string[], setValues: (items: string[]) => void) => setValues(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  const save = async () => { setBusy(true);setError("");try { const payload = { name, template_code: template.code, config: { device_id: template.scene === "device" ? deviceId : undefined, device_ids: template.scene === "organization" ? deviceIds : undefined, telemetry_stream_ids: template.scene === "device" ? telemetryIds : undefined, comparison_stream: template.scene === "organization" && comparisonStream ? comparisonStream : undefined, image_stream_ids: imageIds, trend_hours: Number(trendHours) } }; const item = wallboard ? await api.wallboards.update(workspaceId, wallboard.id, payload) : await api.wallboards.create(workspaceId, payload); onSaved(item); } catch(e){setError(formatApiError(e).message)} finally{setBusy(false)} };
  const telemetry = streams.data?.items.filter((item: DataStream) => item.type === "telemetry") ?? []; const images = streams.data?.items.filter((item: DataStream) => item.type === "image") ?? [];
  return <div className="modal-layer"><button type="button" className="modal-backdrop" aria-label="关闭大屏配置" onClick={onClose}/><div className="modal-card wallboard-editor"><div className="panel-header"><div><div className="panel-kicker">{wallboard ? "编辑大屏" : "配置模板"}</div><h2>{template.name}</h2></div><CloseButton onClick={onClose}/></div><div className="wallboard-editor-grid"><label><span>大屏名称</span><TextInput value={name} onChange={(e) => setName(e.target.value)}/></label>{template.scene === "device" && <label><span>目标设备</span><DeviceCombobox devices={devices.data?.items ?? []} value={deviceId} onChange={(id) => {setDeviceId(id);setTelemetryIds([]);setImageIds([])}} ariaLabel="搜索大屏目标设备"/></label>}<label><span>趋势时间范围</span><SelectInput value={trendHours} onChange={(e) => setTrendHours(e.target.value)}><option value="24">最近 24 小时</option><option value="72">最近 3 天</option><option value="168">最近 7 天</option><option value="720">最近 30 天</option></SelectInput></label></div>{template.scene === "organization" && <MultiDeviceSelector devices={devices.data?.items ?? []} selected={deviceIds} onAdd={(id)=>{if(!deviceIds.includes(id)&&deviceIds.length<50){setDeviceIds([...deviceIds,id]);setComparisonStream("");setImageIds([])}}} onRemove={(id)=>{setDeviceIds(deviceIds.filter((value)=>value!==id));setComparisonStream("");setImageIds([])}}/>} {template.scene === "device" ? <StreamChoices title="实时与趋势指标" items={telemetry} selected={telemetryIds} toggle={(id) => toggle(id,telemetryIds,setTelemetryIds)}/> : <label className="wallboard-comparison-select"><span>跨设备对比核心指标</span><SelectInput value={comparisonStream} onChange={(event) => setComparisonStream(event.target.value)}><option value="">请选择一个数据流</option>{telemetry.map((item) => <option key={item.id} value={item.id}>{item.name}{item.unit ? ` · ${item.unit}` : ""}</option>)}</SelectInput></label>}<StreamChoices title="图片数据流" items={images} selected={imageIds} toggle={(id) => toggle(id,imageIds,setImageIds)}/>{error && <div className="command-note">{error}</div>}<div className="modal-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={busy || !name || (template.scene === "device" && !deviceId)} onClick={() => void save()}>{busy ? "正在保存…" : "保存并预览"}</Button></div></div></div>;
}
function MultiDeviceSelector({devices,selected,onAdd,onRemove}:{devices:Awaited<ReturnType<typeof api.devices.list>>["items"];selected:string[];onAdd:(id:string)=>void;onRemove:(id:string)=>void}) { const selectedDevices=devices.filter((item)=>selected.includes(item.id));return <section className="wallboard-streams wallboard-device-selector"><h3>展示设备（不选则展示组织全部，最多 50 台）</h3><DeviceCombobox devices={devices} value="" onChange={onAdd} ariaLabel="搜索并添加展示设备" placeholder="搜索并添加设备"/>{selectedDevices.length?<div>{selectedDevices.map((item)=><label key={item.id}><input type="checkbox" checked onChange={()=>onRemove(item.id)}/><span>{item.name}</span></label>)}</div>:<p>当前将展示组织全部设备。</p>}</section> }
function StreamChoices({ title, items, selected, toggle }: { title: string; items: Array<{ id: string; name: string; unit?: string }>; selected: string[]; toggle: (id: string) => void }) { return <section className="wallboard-streams"><h3>{title}</h3>{!items.length ? <p>选择目标资源后显示可用数据流。</p> : <div>{items.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)}/><span>{item.name}{item.unit ? ` · ${item.unit}` : ""}</span></label>)}</div>}</section>; }

export function WallboardPlayPage() {
  const { id = "" } = useParams(); const { currentId } = useWorkspace(); const navigate = useNavigate(); const [lastGood, setLastGood] = useState<WallboardSnapshot | null>(null); const [failed, setFailed] = useState(false);
  const board = useQuery({ queryKey: workspaceQueryKey(currentId,"wallboard",id), queryFn: () => api.wallboards.get(currentId!,id), enabled:Boolean(currentId&&id) });
  const snapshot = useQuery({ queryKey: workspaceQueryKey(currentId,"wallboard-snapshot",id), queryFn: () => api.wallboards.snapshot(currentId!,id), enabled:Boolean(currentId&&id), refetchInterval:60_000 });
  useEffect(()=>{if(snapshot.data){setLastGood(snapshot.data);setFailed(false)}else if(snapshot.isError)setFailed(true)},[snapshot.data,snapshot.isError]);
  useEffect(()=>{const timer=window.setInterval(()=>void snapshot.refetch(),300_000);return()=>window.clearInterval(timer)},[snapshot.refetch]);
  const displaySnapshot = snapshot.data ?? lastGood;
  if (board.isLoading || (!displaySnapshot && snapshot.isLoading)) return <div className="wallboard-player-state">正在加载大屏…</div>; if (board.isError || (!displaySnapshot && snapshot.isError)) return <div className="wallboard-player-state">大屏加载失败 <Button onClick={() => navigate("/wallboards")}>返回</Button></div>;
  const template = { component_key: board.data!.component_key, name: board.data!.template_name } as WallboardTemplate;
  return <main className="wallboard-player"><div className="wallboard-player-toolbar"><strong>{board.data!.name}</strong>{failed && <span className="wallboard-refresh-error">数据更新失败，保留 {lastGood ? new Date(lastGood.generated_at).toLocaleTimeString() : "上次"} 数据</span>}<Button variant="secondary" onClick={() => void snapshot.refetch()}><RefreshCw size={14}/>刷新</Button><Button variant="secondary" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}><Maximize2 size={14}/>全屏</Button><Button variant="secondary" onClick={() => navigate("/wallboards")}><X size={14}/>退出</Button></div><div className="wallboard-stage"><WallboardCanvas template={template} snapshot={displaySnapshot!}/></div></main>;
}

function WallboardCanvas({ template, snapshot }: { template: WallboardTemplate; snapshot: WallboardSnapshot }) {
  const multi = template.component_key === "fleet-overview-v1";
  return multi ? <FleetWallboard template={template} snapshot={snapshot}/> : <SingleDeviceWallboard template={template} snapshot={snapshot}/>;
}

function WallboardHeader({ template, snapshot }: { template: WallboardTemplate; snapshot: WallboardSnapshot }) {
  return <header className="wallboard-head"><div><small>IN-SITU ECOCLOUD</small><h1>{template.name}</h1></div><div><span className="wallboard-live"><i/>实时数据</span><strong>{snapshot.workspace.name}</strong><span>{formatDateTime(snapshot.generated_at)}</span></div></header>;
}

function SingleDeviceWallboard({ template, snapshot }: { template: WallboardTemplate; snapshot: WallboardSnapshot }) {
  const device = snapshot.devices[0];
  const latestImages = latestImageItems(snapshot);
  return <div className="wallboard-canvas wallboard-device-layout"><WallboardHeader template={template} snapshot={snapshot}/><div className="wallboard-body">
    <aside className="wallboard-column"><ScreenPanel title="设备档案">{device ? <DeviceFacts device={device}/> : <EmptyLine text="未找到目标设备"/>}</ScreenPanel></aside>
    <section className="wallboard-column wallboard-single-data"><ScreenPanel title="核心实时指标"><div className="wallboard-metric-list">{snapshot.metrics.length ? snapshot.metrics.map((metric) => <div key={metric.data_stream_id}><span>{metric.name}</span><strong>{metric.latest_value ?? "--"}<small>{metric.unit}</small></strong><time>{formatDateTime(metric.latest_at)}</time></div>) : <EmptyLine text="未配置实时指标" icon={<Activity/>}/>}</div></ScreenPanel><TrendPanel metrics={snapshot.metrics}/></section>
    <aside className="wallboard-column wallboard-single-corner"><section className="wallboard-map-panel"><WallboardCesiumMap devices={device ? [device] : []} mode="single"/>{device && !hasLocation(device) && <LocationNotice count={1}/>}</section><ScreenPanel title="采集概览"><div className="wallboard-single-kpis"><Kpi label="监测指标" value={snapshot.metrics.length}/><Kpi label="趋势数据" value={snapshot.metrics.reduce((total, metric) => total + metric.points.length, 0)}/><Kpi label="最新影像" value={latestImages.length}/><Kpi label="定位状态" value={device && hasLocation(device) ? "正常" : "缺失"}/></div></ScreenPanel><ImagePanel items={latestImages} limit={8}/></aside>
  </div><div className="wallboard-bottom"><ScreenPanel title="指标统计"><MetricStatistics metrics={snapshot.metrics}/></ScreenPanel></div></div>;
}

function FleetWallboard({ template, snapshot }: { template: WallboardTemplate; snapshot: WallboardSnapshot }) {
  const [selectedId, setSelectedId] = useState(snapshot.devices[0]?.id ?? "");
  useEffect(() => { if (!snapshot.devices.some((item) => item.id === selectedId)) setSelectedId(snapshot.devices[0]?.id ?? ""); }, [snapshot.devices, selectedId]);
  const selected = snapshot.devices.find((item) => item.id === selectedId) ?? snapshot.devices[0];
  const online = snapshot.devices.filter(isOnline).length;
  const offline = snapshot.devices.length - online;
  const alarms = snapshot.devices.filter((item) => item.status === "alarm" || item.status === "warning").length;
  const unavailable = snapshot.devices.filter((item) => Boolean(item.runtime_error)).length;
  const warning = snapshot.devices.filter(needsAttention).length;
  const unlocated = snapshot.devices.filter((item) => !hasLocation(item)).length;
  const sites = new Set(snapshot.devices.map((item) => item.site_name).filter(Boolean));
  return <div className="wallboard-canvas wallboard-fleet-layout"><WallboardHeader template={template} snapshot={snapshot}/><div className="wallboard-fleet-overview">
    <Kpi label="设备总数" value={snapshot.devices.length}/><Kpi label="在线设备" value={online}/><Kpi label="离线设备" value={offline}/><Kpi label="设备告警" value={alarms}/><Kpi label="运行不可用" value={unavailable}/><Kpi label="未定位" value={unlocated}/>
  </div><div className="wallboard-body">
    <section className="wallboard-map-panel"><div className="wallboard-map-summary"><span>设备空间分布</span><small>{sites.size} 个站点 · {snapshot.devices.length ? `${Math.round(online / snapshot.devices.length * 100)}% 在线` : "暂无设备"}</small></div><WallboardCesiumMap devices={snapshot.devices} mode="multi" selectedDeviceId={selected?.id} onSelectDevice={setSelectedId}/>{unlocated > 0 && <LocationNotice count={unlocated}/>}</section>
    <aside className="wallboard-column wallboard-fleet-operations"><ScreenPanel title="设备焦点">{selected ? <FleetDeviceFocus device={selected}/> : <EmptyLine text="暂无设备"/>}</ScreenPanel><ScreenPanel title={`异常设备队列 · ${warning}`}><div className="wallboard-attention-list">{snapshot.devices.filter(needsAttention).slice(0, 6).map((device) => <button type="button" className={device.id === selected?.id ? "selected" : ""} key={device.id} onClick={() => setSelectedId(device.id)}><span className={`wallboard-status ${statusClass(device)}`}/><strong>{device.name}</strong><small>{attentionReason(device)}</small></button>)}{!warning && <EmptyLine text="当前无异常设备"/>}</div></ScreenPanel></aside>
  </div><div className="wallboard-bottom"><TrendPanel metrics={snapshot.metrics} devices={snapshot.devices}/><ImagePanel items={latestImageItems(snapshot)}/></div></div>;
}

function ScreenPanel({ title, children }: { title: string; children: ReactNode }) { return <section className="wallboard-screen-panel"><h2>{title}</h2>{children}</section>; }
function Kpi({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function MetricStatistics({ metrics }: { metrics: WallboardSnapshot["metrics"] }) {
  return metrics.length ? <div className="wallboard-stat-table"><header><span>指标</span><span>最小</span><span>平均</span><span>最大</span></header>{metrics.map((metric) => { const values = metric.points.map((point) => point.value); const min = values.length ? Math.min(...values) : undefined; const max = values.length ? Math.max(...values) : undefined; const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined; return <div key={metric.data_stream_id}><strong>{metric.name}<small>{metric.unit}</small></strong><span>{formatNumber(min)}</span><span>{formatNumber(average)}</span><span>{formatNumber(max)}</span></div>; })}</div> : <EmptyLine text="暂无统计数据"/>;
}
function DeviceFacts({ device }: { device: WallboardSnapshot["devices"][number] }) {
  return <div className="wallboard-device-facts"><div className="wallboard-device-name"><span className={`wallboard-status ${statusClass(device)}`}/><div><strong>{device.name}</strong><small>{device.device_type}</small></div></div><dl><dt>所属站点</dt><dd>{device.site_name || "未关联"}</dd><dt>运行状态</dt><dd>{device.runtime_error ? "运行信息不可用" : isOnline(device) ? "在线" : "离线"}</dd><dt><Battery/>电量</dt><dd>{formatPercent(device.battery)}</dd><dt><Signal/>信号</dt><dd>{formatPercent(device.signal)}</dd><dt><Radio/>最近上报</dt><dd>{formatDateTime(device.last_reported_at)}</dd><dt>位置来源</dt><dd>{device.location_source === "device" ? "设备上报" : device.location_source === "site" ? "站点坐标" : "未配置"}</dd></dl>{device.runtime_error && <div className="wallboard-runtime-warning"><TriangleAlert/> {device.runtime_error}</div>}</div>;
}
function FleetDeviceFocus({ device }: { device: WallboardSnapshot["devices"][number] }) {
  return <div className="wallboard-fleet-focus"><header><div><span className={`wallboard-status ${statusClass(device)}`}/><strong>{device.name}</strong></div><small>{device.site_name || "未关联站点"}</small></header><div><Kpi label="运行状态" value={device.runtime_error ? "不可用" : isOnline(device) ? "在线" : "离线"}/><Kpi label="电量" value={formatPercent(device.battery)}/><Kpi label="信号" value={formatPercent(device.signal)}/></div><footer><span>最近上报</span><strong>{formatDateTime(device.last_reported_at)}</strong></footer></div>;
}
function TrendPanel({ metrics, devices = [] }: { metrics: WallboardSnapshot["metrics"]; devices?: WallboardSnapshot["devices"] }) {
  const names = new Map(devices.map((item) => [item.id, item.name]));
  const chartMetrics = metrics.map((metric) => ({ ...metric, chartName: names.get(metric.device_id) ?? metric.name }));
  return <ScreenPanel title={devices.length ? "核心指标设备趋势" : "指标趋势"}>{chartMetrics.length ? <div className="wallboard-trend-grid">{chartMetrics.map((metric,index)=><article className="wallboard-trend-item" key={metric.data_stream_id}><header><div><strong>{metric.chartName}</strong>{devices.length > 0 && <small>{metric.name}</small>}</div><span>{metric.latest_value ?? "--"}<small>{metric.unit}</small></span></header><div><ResponsiveContainer width="100%" height="100%"><LineChart data={metricPoints(metric)} margin={{top:4,right:4,bottom:0,left:-22}}><XAxis dataKey="time" stroke="#667078" tickLine={false} axisLine={false}/><YAxis stroke="#667078" tickLine={false} axisLine={false}/><Tooltip/><Line dataKey="value" name={metric.chartName} stroke={["#a8e063","#69b8ff","#f4c56a","#ff7d8a","#bd92ff"][index%5]} dot={false} strokeWidth={2}/></LineChart></ResponsiveContainer></div></article>)}</div>:<EmptyLine text="未配置趋势指标" icon={<Activity/>}/>}</ScreenPanel>;
}
function ImagePanel({ items, limit = 3 }: { items: Array<{ id: string; stream: string; preview_url?: string; thumbnail_url?: string; captured_at: string }>; limit?: number }) { return <ScreenPanel title="最新图片">{items.length ? <div className="wallboard-image-grid">{items.slice(0,limit).map((item)=><figure key={item.id}><img src={item.preview_url || item.thumbnail_url} alt={item.stream}/><figcaption>{item.stream} · {formatDateTime(item.captured_at)}</figcaption></figure>)}</div> : <EmptyLine text="未配置图片流" icon={<ImageIcon/>}/>}</ScreenPanel>; }
function LocationNotice({ count }: { count: number }) { return <div className="wallboard-location-notice"><MapPinOff/>{count === 1 ? "设备位置未配置" : `${count} 台设备未配置位置`}</div>; }
function EmptyLine({ text, icon }: { text: string; icon?: ReactNode }) { return <div className="wallboard-empty">{icon}{text}</div>; }
function hasLocation(device: WallboardSnapshot["devices"][number]) { return Number.isFinite(device.latitude) && Number.isFinite(device.longitude); }
function isOnline(device: WallboardSnapshot["devices"][number]) { return device.status === "online" || device.status === "active"; }
function needsAttention(device: WallboardSnapshot["devices"][number]) { return Boolean(device.runtime_error) || !isOnline(device) || device.status === "alarm" || device.status === "warning"; }
function statusClass(device: WallboardSnapshot["devices"][number]) { return device.runtime_error ? "unavailable" : device.status === "alarm" || device.status === "warning" ? "warning" : isOnline(device) ? "online" : "offline"; }
function attentionReason(device: WallboardSnapshot["devices"][number]) { return device.runtime_error ? "运行信息不可用" : device.status === "alarm" || device.status === "warning" ? "设备告警" : "设备离线"; }
function formatPercent(value?: number) { return value == null ? "--" : `${Math.round(value)}%`; }
function formatNumber(value?: number) { return value == null ? "--" : Number(value.toFixed(2)).toString(); }
function formatDateTime(value?: string) { if (!value) return "--"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString(); }
function latestImageItems(snapshot: WallboardSnapshot) { return snapshot.images.flatMap((stream) => (stream.items ?? []).slice(0,3).map((item) => ({...item,stream:stream.name}))); }
function metricPoints(metric: WallboardSnapshot["metrics"][number]) { return (metric.points ?? []).flatMap((point)=>{const date=new Date(point.ts);return Number.isNaN(date.getTime())?[]:[{time:date.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),value:point.value}]}); }
