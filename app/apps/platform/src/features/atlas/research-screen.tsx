import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, Search, Settings2, X } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, deviceTopologyRoleLabel, formatApiError, type DeviceMapItem } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import type { AtlasScreenProps } from "./atlas-screen-props";
import { useAtlasDevice } from "./use-atlas-device";
import { AnimatedNumber } from "./eco-animated-number";
import { AtlasMetricSelection } from "./atlas-metric-settings";
import { AtlasMedia } from "./atlas-media";
import { reportingCounts } from "./atlas-health";
import { numberLabel, seriesSummary } from "./atlas-model";
import { ObservatoryAutoScroll } from "../../shared/observatory/observatory-motion";
import "./research-screen.css";

export function ResearchScreen(props: AtlasScreenProps) {
  return <div className={`research-screen${props.config.layout === "map" ? " research-map-priority" : ""}`} data-motion={props.motion.enabled ? "running" : "paused"}>
    <header className="research-header"><div className="research-title"><span>FIELD NOTES / ECOLOGICAL OBSERVATORY</span><h1>{props.title}</h1></div><div className="research-edition">科研工作台<span>RESEARCH EDITION</span></div><nav aria-label="大屏操作"><button type="button" onClick={props.onBack}><ArrowLeft size={15} />管理</button>{props.canManage && <button type="button" onClick={props.onEdit}><Settings2 size={15} />配置</button>}<button type="button" onClick={props.motion.toggle} disabled={props.motion.reduced} aria-label={props.motion.paused ? "播放动画" : "暂停动画"}>{props.motion.paused ? <Play size={15} /> : <Pause size={15} />}</button><button type="button" onClick={props.onFullscreen} aria-label={props.presenting ? "退出全屏" : "全屏"}>{props.presenting ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button></nav></header>
    <ResearchOverview {...props} />
    <div className="research-body"><ResearchCatalog {...props} />{props.selectedDevice ? <ResearchWorkingArea key={props.selectedDevice.device_id} {...props} device={props.selectedDevice} /> : <><main className="research-workspace" data-trends={props.config.show_trends !== false}><section className="research-map-paper"><header><h2>观测空间</h2><span>SPATIAL FIELD</span></header><div className="research-map-region">{props.map}</div></section><div className="research-empty">选择设备以查看观测序列</div></main><aside className="research-observations"><h2>观测记录</h2><div className="research-empty">请选择设备</div></aside></>}</div>
    {props.warning && <div className="research-warning" role="alert">{props.warning}</div>}{props.settings}
  </div>;
}

function ResearchOverview({ workspaceId, devices, config, motion }: AtlasScreenProps) {
  const ids = devices.filter(device => !device.gateway_device_id).map(device => device.device_id).sort();
  const scoped = !!config.device_ids?.length;
  const overview = useQuery({ queryKey: workspaceQueryKey(workspaceId, "dashboard", "7"), queryFn: () => api.dashboard(workspaceId, 7), enabled: !scoped, staleTime: 30000, refetchInterval: 30000, retry: false });
  const runtime = useQuery({ queryKey: workspaceQueryKey(workspaceId, "atlas", "runtime", ids.join(",")), queryFn: () => api.devices.runtime(ids), enabled: scoped && ids.length > 0, staleTime: 60000, refetchInterval: 60000, retry: false });
  const counts = reportingCounts(ids, runtime.isError ? undefined : runtime.data, Date.now());
  const unknown = overview.data && overview.data.devices.reporting === 0 && overview.data.devices.unknown >= overview.data.devices.total - overview.data.devices.inactive && overview.data.devices.total > overview.data.devices.inactive;
  const normal = scoped ? ids.length === 0 ? 0 : runtime.data && !runtime.isError && counts.unknown < counts.total ? counts.normal : undefined : unknown ? undefined : overview.data?.devices.reporting;
  const error = scoped ? runtime.error : overview.error;
  const stats = [
    { label: "接入设备", value: scoped ? ids.length : overview.data?.devices.total, unit: "DEVICES" },
    { label: "正常上报", value: normal, unit: "REPORTING" },
    { label: "今日采集", value: scoped ? undefined : overview.data?.records.today.value, unit: "OBSERVATIONS", partial: overview.data?.records.today.complete === false },
    { label: "采集图片", value: scoped ? undefined : overview.data?.images.total.value, unit: "IMAGES", partial: overview.data?.images.total.complete === false },
  ];
  return <section className="research-overview" aria-label="观测总览"><div className="research-overview-label"><span>观测总览</span><small>{scoped ? "当前设备范围" : "工作空间"}</small></div>{stats.map((stat, index) => <div className="research-stat" key={stat.label}><span>{stat.label}</span><strong>{stat.partial && stat.value != null && "≥"}<AnimatedNumber value={stat.value} enabled={motion.enabled} formatter={value => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)} /></strong><small>{String(index + 1).padStart(2, "0")} / {stat.unit}</small></div>)}{error && <button type="button" className="research-stat-error" onClick={() => { if (scoped) void runtime.refetch(); else void overview.refetch(); }} title={formatApiError(error).message}>重试</button>}</section>;
}

function ResearchCatalog(props: AtlasScreenProps) {
  const [search, setSearch] = useState("");
  const rows = props.devices.filter(device => !device.gateway_device_id && (props.kind === "all" || (props.kind === "network" ? ["gateway", "gateway_node"].includes(device.device_type) : device.device_type === props.kind)) && `${device.name} ${device.serial_no}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <aside className="research-catalog"><header><h2>设备目录</h2><span>{rows.length}</span></header><label className="research-search"><Search size={14} /><input aria-label="搜索设备" placeholder="名称 / 序列号" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="设备类型" value={props.kind} onChange={event => props.onKindChange(event.target.value)}><option value="all">全部类型</option><option value="standalone">标准站</option><option value="network">组网站</option><option value="carbon_sink">碳汇</option><option value="camera">监控</option></select><ObservatoryAutoScroll className="research-catalog-list" label="设备目录" paused={!props.motion.enabled} resetKey={`${props.kind}:${search}:${rows.map(device => device.device_id).join(",")}`}>{rows.map((device, index) => <button type="button" key={device.device_id} aria-pressed={props.selectedDevice?.device_id === device.device_id} onClick={() => props.onSelect(device.device_id)}><span className="research-device-index">{String(index + 1).padStart(2, "0")}</span><span><strong>{device.name}</strong><small>{device.serial_no}</small><em>{deviceTopologyRoleLabel(device.device_type)}</em></span><ArrowUpRight size={13} /></button>)}{!rows.length && <div className="research-empty">暂无匹配设备</div>}</ObservatoryAutoScroll></aside>;
}

function ResearchWorkingArea(props: AtlasScreenProps & { device: DeviceMapItem }) {
  const model = useAtlasDevice({ device: props.device, workspaceId: props.workspaceId, boardId: props.boardId, config: props.config, selectedNodeKey: props.selectedNodeKey, onNodeChange: props.onSelectNode });
  const [hours, setHours] = useState(props.config.trend_hours ?? 24);
  const [gallery, setGallery] = useState(false);
  const [asset, setAsset] = useState(false);
  const imageStreams = (model.node?.streams ?? (model.isGateway && model.nodeKey !== "gateway" ? [] : model.catalog)).filter(stream => stream.type === "image" && stream.status === "active" && (model.node || stream.device_id === model.imageDevice));
  const restricted = model.node?.target.kind === "gateway_node" || (model.isGateway && model.nodeKey !== "gateway" && !model.node);
  const mediaProps = { appearance: "eco" as const, workspaceId: props.workspaceId, deviceId: model.imageDevice, assetDeviceId: props.device.device_id, streams: imageStreams, restrictToStreams: restricted, range: model.range };
  return <><main className="research-workspace" data-trends={props.config.show_trends !== false}><section className="research-map-paper"><header><div><h2>观测空间</h2><span>{props.device.name}</span></div><span>SPATIAL FIELD</span></header><div className="research-map-region">{props.map}</div></section>{props.config.show_trends !== false && <ResearchTrend model={model} enabled={props.motion.enabled} />}</main>
    <aside className="research-observations"><div className="research-observations-heading"><span>OBSERVATION LOG</span><h2>{props.device.name}</h2><small>{props.device.serial_no}</small></div>{model.isGateway && <select aria-label="选择节点" value={model.nodeKey} onChange={event => { model.setNodeKey(event.target.value); model.setChosen(null); props.onSelectNode(event.target.value); }}><option value="gateway">网关概况</option>{model.nodes.data?.items.map(node => <option key={node.key} value={node.key}>{node.name}</option>)}</select>}
    <div className="research-periods">{[[24, "24小时"], [168, "7天"], [720, "30天"]].map(([value, label]) => <button type="button" key={value} aria-pressed={hours === value} onClick={() => { setHours(Number(value)); model.setHours(Number(value)); }}>{label}</button>)}</div>
    <header className="research-section-title"><h3>关注指标</h3><button type="button" onClick={() => { model.setMetricDraft(model.selected); model.setPreferenceError(""); model.setPickerOpen(true); }}>全部 {model.metrics.length}<ChevronRight size={12} /></button></header>
    {model.streams.error || model.nodes.error ? <p className="research-error" role="alert">{formatApiError(model.streams.error ?? model.nodes.error).message}</p> : <div className="research-observation-table">{model.visible.map((stream, index) => {
      const result = model.results.get(stream.id); const summary = seriesSummary(result?.data?.series.find(series => series.data_stream_id === stream.id));
      return <button type="button" key={stream.id} aria-pressed={(model.focusedChart ?? model.visible[0]?.id) === stream.id} onClick={() => model.setFocusedChart(stream.id)}><span><small>{String(index + 1).padStart(2, "0")}</small>{stream.name}</span><strong><AnimatedNumber value={summary.latest?.value} enabled={props.motion.enabled} /><small>{stream.unit}</small></strong></button>;
    })}{!model.visible.length && <div className="research-empty">{model.streams.isLoading || model.nodes.isLoading ? "加载指标…" : "暂无关注指标"}</div>}</div>}
    {props.config.show_images !== false && <section className="research-imagery" hidden={!model.mediaAvailable}><header className="research-section-title"><h3>采集图片</h3><button type="button" onClick={() => { setAsset(false); setGallery(true); }}>图库<ArrowUpRight size={12} /></button></header><AtlasMedia key={`${model.nodeKey}:${model.imageDevice}`} {...mediaProps} asset={false} pageSize={2} onAvailability={model.setMediaAvailable} /></section>}
    </aside>
    <Dialog.Root open={model.pickerOpen} onOpenChange={model.setPickerOpen}><Dialog.Portal><Dialog.Overlay className="research-modal-overlay" /><Dialog.Content className="research-modal research-preferences" aria-describedby={undefined}><header><Dialog.Title>关注指标</Dialog.Title><Dialog.Close asChild><button type="button" aria-label="关闭指标设置"><X size={18} /></button></Dialog.Close></header><AtlasMetricSelection key={model.storageKey} appearance="eco" metrics={model.metrics} value={model.metricDraft} onChange={model.setMetricDraft} />{model.preferenceError && <p role="alert">{model.preferenceError}</p>}<footer><button type="button" onClick={() => model.savePreference(true)}>恢复默认</button><button type="button" onClick={() => model.savePreference()}>保存</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={gallery} onOpenChange={setGallery}><Dialog.Portal><Dialog.Overlay className="research-modal-overlay" /><Dialog.Content className="research-modal research-gallery" aria-describedby={undefined}><header><Dialog.Title>观测影像</Dialog.Title><Dialog.Close asChild><button type="button" aria-label="关闭图库"><X size={18} /></button></Dialog.Close></header><div className="research-periods"><button type="button" aria-pressed={!asset} onClick={() => setAsset(false)}>采集图片</button><button type="button" aria-pressed={asset} onClick={() => setAsset(true)}>资产照片</button></div><AtlasMedia key={`${asset}:${model.nodeKey}`} {...mediaProps} deviceId={asset ? props.device.device_id : model.imageDevice} asset={asset} pageSize={12} /></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}

function ResearchTrend({ model, enabled }: { model: ReturnType<typeof useAtlasDevice>; enabled: boolean }) {
  const index = Math.max(0, model.visible.findIndex(stream => stream.id === model.focusedChart));
  const stream = model.visible[index];
  useEffect(() => { if (stream && model.focusedChart !== stream.id) model.setFocusedChart(stream.id); }, [stream?.id, model.focusedChart]);
  const result = stream ? model.results.get(stream.id) : undefined;
  const series = result?.data?.series.find(item => item.data_stream_id === stream?.id);
  const summary = seriesSummary(series);
  const minimum = summary.min ?? 0, maximum = summary.max ?? 0;
  const pad = maximum > minimum ? (maximum - minimum) * 0.15 : Math.max(Math.abs(minimum) * 0.02, 0.01);
  const multiDay = Date.parse(model.range.end) - Date.parse(model.range.start) > 86400000;
  return <section className="research-trend"><header><div><span>TIME SERIES</span><h2>观测序列</h2></div><div className="research-trend-pagination"><button type="button" aria-label="上一指标" disabled={!index} onClick={() => model.setFocusedChart(model.visible[index - 1].id)}><ChevronLeft size={16} /></button><span>{stream ? index + 1 : 0} / {model.visible.length}</span><button type="button" aria-label="下一指标" disabled={index >= model.visible.length - 1} onClick={() => model.setFocusedChart(model.visible[index + 1].id)}><ChevronRight size={16} /></button></div></header><div className="research-trend-label"><select aria-label="趋势指标" disabled={!stream} value={stream?.id ?? ""} onChange={event => model.setFocusedChart(event.target.value)}>{model.visible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span>{stream?.unit}</span><strong><AnimatedNumber value={summary.latest?.value} enabled={enabled} /></strong></div>
    <div className="research-plot">{!stream ? <div className="research-empty">选择关注指标</div> : result?.isFetching && !series ? <div className="research-empty" role="status">正在加载观测序列…</div> : result?.error || series?.error ? <div className="research-error" role="alert">{series?.error ?? formatApiError(result?.error).message}</div> : !summary.points.length ? <div className="research-empty">暂无观测数据</div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={summary.points.map(point => ({ time: Date.parse(point.ts), value: point.value }))} margin={{ top: 8, right: 14, bottom: 4, left: 0 }}><defs><linearGradient id="research-plot-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#386b57" stopOpacity={0.2} /><stop offset="100%" stopColor="#386b57" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid stroke="#dce3d8" vertical={false} strokeDasharray="2 5" /><XAxis dataKey="time" type="number" domain={[Date.parse(model.range.start), Date.parse(model.range.end)]} tickFormatter={time => multiDay ? new Date(time).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#7b877b", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={38} /><YAxis width={56} domain={[minimum - pad, maximum + pad]} tickFormatter={numberLabel} tick={{ fill: "#7b877b", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "#fffef9", border: "1px solid #bccabb", color: "#294638", borderRadius: 4 }} labelFormatter={time => new Date(Number(time)).toLocaleString("zh-CN")} /><Area dataKey="value" name={stream.name} unit={stream.unit} stroke="#386b57" strokeWidth={2} fill="url(#research-plot-fill)" isAnimationActive={enabled} animationDuration={500} animationEasing="ease-out" dot={false} /></AreaChart></ResponsiveContainer>}</div>
  </section>;
}
