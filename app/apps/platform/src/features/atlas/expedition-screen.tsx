import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, ArrowDown, ArrowUp, Camera, ChevronLeft, ChevronRight, Compass, ExternalLink, Leaf, Maximize2, Minimize2, Network, Pause, Pin, Play, RadioTower, Search, Settings2, Video, X } from "lucide-react";
import { api, formatApiError, type DeviceMapItem } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { ObservatoryAutoScroll } from "../../shared/observatory/observatory-motion";
import { AnimatedNumber } from "./eco-animated-number";
import { AtlasMedia } from "./atlas-media";
import { numberLabel, seriesSummary } from "./atlas-model";
import { useAtlasDevice } from "./use-atlas-device";
import type { AtlasScreenProps } from "./atlas-screen-props";
import "./expedition-screen.css";

const categories = [
  { key: "standalone", name: "标准站", Icon: RadioTower },
  { key: "network", name: "组网站", Icon: Network },
  { key: "carbon_sink", name: "碳汇", Icon: Leaf },
  { key: "camera", name: "监控", Icon: Video },
];

/** Amber field command is a separate composition; it shares only data behavior. */
export function ExpeditionScreen(props: AtlasScreenProps) {
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setReady(true), 40); return () => clearTimeout(timer); }, []);
  const filtered = props.devices.filter(device =>
    (props.kind === "all" || (props.kind === "network" ? ["gateway", "gateway_node"].includes(device.device_type) : device.device_type === props.kind))
    && `${device.name} ${device.serial_no}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const hasCoordinates = props.selectedDevice && Number.isFinite(props.selectedDevice.latitude) && Number.isFinite(props.selectedDevice.longitude);
  return <main className="expedition-screen" data-motion={props.motion.enabled ? "running" : "paused"} data-ready={ready || !props.motion.enabled}><div className="expedition-canvas">
    <div className="expedition-map-stage">{props.map}</div>
    <div className="expedition-atmosphere" aria-hidden="true"/>
    <header className="expedition-header">
      <div className="expedition-wordmark"><i/><span>FIELD OBSERVATORY</span><h1>{props.title}</h1></div>
      <ExpeditionStatistics workspaceId={props.workspaceId} scoped={!!props.config.device_ids?.length} devices={props.devices} motionEnabled={props.motion.enabled}/>
      <nav className="expedition-actions" aria-label="大屏操作">
        <button type="button" onClick={props.onBack} aria-label="返回一张图管理" title="返回管理"><ArrowLeft size={18}/></button>
        {props.canManage && <button type="button" onClick={props.onEdit} aria-label="编辑大屏" title="编辑大屏"><Settings2 size={18}/></button>}
        <button type="button" onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")} aria-label="新窗口打开" title="新窗口打开"><ExternalLink size={17}/></button>
        <button type="button" onClick={props.motion.toggle} disabled={props.motion.reduced} aria-label={props.motion.paused ? "播放动画" : "暂停动画"} title={props.motion.paused ? "播放动画" : "暂停动画"}>{props.motion.paused ? <Play size={17}/> : <Pause size={17}/>}</button>
        <button type="button" onClick={props.onFullscreen} aria-label={props.presenting ? "退出全屏" : "全屏"}>{props.presenting ? <Minimize2 size={19}/> : <Maximize2 size={19}/>}</button>
      </nav>
    </header>
    <aside className="expedition-rail">
      <div className="expedition-rail-heading"><span>01 / OBSERVATION SITES</span><h2>观测目录</h2></div>
      <div className="expedition-categories" role="group" aria-label="设备类型">{categories.map(({ key, name, Icon }) => <button type="button" key={key} aria-pressed={props.kind === key} onClick={() => props.onKindChange(props.kind === key ? "all" : key)}><Icon size={18}/>{name}</button>)}</div>
      <label className="expedition-search"><Search size={14}/><input aria-label="搜索观测设备" placeholder="搜索名称 / SN" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <ObservatoryAutoScroll className="expedition-site-list" label="观测设备列表" paused={!props.motion.enabled} resetKey={`${search}:${props.kind}:${props.selectedDevice?.device_id ?? ""}:${filtered.map(device => device.device_id).join(",")}`}>
        {filtered.map((device, index) => <button type="button" key={device.device_id} aria-pressed={device.device_id === props.selectedDevice?.device_id} onClick={() => props.onSelect(device.device_id)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{device.name}</strong><small>{device.serial_no}</small></div><ChevronRight size={13}/></button>)}
        {!filtered.length && <div className="expedition-state">暂无匹配设备</div>}
      </ObservatoryAutoScroll>
      <div className="expedition-rail-count"><span>当前范围</span><strong>{filtered.length.toString().padStart(2, "0")}</strong></div>
    </aside>
    <div className="expedition-location">
      <div className="expedition-location-kicker"><span className="expedition-beacon"/>SELECTED OBSERVATION</div>
      <h2 key={props.selectedDevice?.device_id}>{props.selectedDevice?.name ?? "全域生态观测"}</h2>
      <div className="expedition-location-details"><Compass size={15}/><span>{hasCoordinates ? `${Math.abs(props.selectedDevice!.latitude!).toFixed(5)}° ${props.selectedDevice!.latitude! < 0 ? "S" : "N"} / ${Math.abs(props.selectedDevice!.longitude!).toFixed(5)}° ${props.selectedDevice!.longitude! < 0 ? "W" : "E"}` : "区域视角"}</span><span>{props.selectedDevice?.serial_no}</span></div>
    </div>
    <div className="expedition-map-reticle" aria-hidden="true"><span/><span/></div>
    <div className="expedition-scale-label"><i/>TERRAIN / OBSERVATION NETWORK</div>
    {props.selectedDevice ? <ExpeditionDock key={props.selectedDevice.device_id} {...props} device={props.selectedDevice}/> : <section className="expedition-dock expedition-state">从观测目录选择设备</section>}
    {props.warning && <div className="expedition-warning" role="alert">{props.warning}</div>}
    {props.settings}
  </div></main>;
}

function ExpeditionStatistics({ workspaceId, scoped, devices, motionEnabled }: { workspaceId: string; scoped: boolean; devices: DeviceMapItem[]; motionEnabled: boolean }) {
  const summary = useQuery({ queryKey: workspaceQueryKey(workspaceId, "dashboard", "7"), queryFn: () => api.dashboard(workspaceId, 7), enabled: !scoped, staleTime: 30000, refetchInterval: query => Math.max(5, Math.min(300, query.state.data?.refresh_interval_seconds ?? 30)) * 1000, retry: false });
  const data = summary.data;
  const reportingUnknown = data && data.devices.reporting === 0 && data.devices.total > data.devices.inactive && data.devices.unknown >= data.devices.total - data.devices.inactive;
  const totals = [
    ["接入设备", scoped ? devices.filter(device => !device.gateway_device_id).length : data?.devices.total],
    ["今日采集", scoped ? undefined : data?.records.today.value],
    ["正常上报", scoped || reportingUnknown ? undefined : data?.devices.reporting],
  ] as const;
  return <div className="expedition-statistics" title={scoped ? "当前设备范围" : "工作空间全部设备"}>{totals.map(([label, value]) => <div key={label}><span>{label}</span><strong><AnimatedNumber value={value} enabled={motionEnabled} formatter={number => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(number)}/></strong></div>)}</div>;
}

function ExpeditionDock(props: AtlasScreenProps & { device: DeviceMapItem }) {
  const model = useAtlasDevice({ device: props.device, workspaceId: props.workspaceId, boardId: props.boardId, config: props.config, selectedNodeKey: props.selectedNodeKey });
  const [hours, setHours] = useState(props.config.trend_hours ?? 24);
  const [metricSearch, setMetricSearch] = useState("");
  const [asset, setAsset] = useState(false);
  const { visible, results, range, selected, metrics } = model;
  const index = Math.max(0, visible.findIndex(stream => stream.id === model.focusedChart));
  const stream = visible[index];
  const result = stream ? results.get(stream.id) : undefined;
  const series = result?.data?.series.find(item => item.data_stream_id === stream?.id);
  const summary = seriesSummary(series);
  const domainPadding = summary.max != null && summary.min != null ? Math.max((summary.max - summary.min) * .16, Math.abs(summary.max) * .01, .01) : .01;
  const imageStreams = (model.node?.streams ?? (model.isGateway && model.nodeKey !== "gateway" ? [] : model.catalog)).filter(item => item.type === "image" && item.status === "active" && (model.node || item.device_id === model.imageDevice));
  const restrictToStreams = model.node?.target.kind === "gateway_node" || (model.isGateway && model.nodeKey !== "gateway" && !model.node);
  const selectMetric = (id: string) => model.setMetricDraft(model.metricDraft.includes(id) ? model.metricDraft.filter(item => item !== id) : [...model.metricDraft, id].slice(0, 6));
  const moveMetric = (id: string, delta: number) => {
    const next = [...model.metricDraft]; const position = next.indexOf(id); const target = position + delta;
    if (position < 0 || target < 0 || target >= next.length) return;
    [next[position], next[target]] = [next[target], next[position]]; model.setMetricDraft(next);
  };
  return <section className="expedition-dock" aria-label="观测数据工作台">
    <div className="expedition-dock-toolbar">
      <div><span className="expedition-beacon"/><strong>{model.node?.name ?? props.device.name}</strong>{model.isGateway && <select aria-label="选择节点" value={model.nodeKey} onChange={event => { model.setNodeKey(event.target.value); model.setChosen(null); props.onSelectNode(event.target.value); }}><option value="gateway">网关概况</option>{model.nodes.data?.items.map(node => <option key={node.key} value={node.key}>{node.name}</option>)}</select>}</div>
      <div className="expedition-time-range">{[[24, "24小时"], [168, "7天"], [720, "30天"]].map(([value, label]) => <button type="button" key={value} aria-pressed={hours === value} onClick={() => { setHours(Number(value)); model.setHours(Number(value)); }}>{label}</button>)}</div>
    </div>
    <div className={`expedition-dock-grid${props.config.show_trends === false ? " expedition-no-trends" : ""}${props.config.show_images === false ? " expedition-no-images" : ""}`}>
      <section className="expedition-readings">
        <header className="expedition-section-title"><div><span>02 / READINGS</span><h3>观测读数</h3></div><Popover.Root open={model.pickerOpen} onOpenChange={open => { model.setPickerOpen(open); if (open) { model.setMetricDraft(selected); model.setPreferenceError(""); setMetricSearch(""); } }}><Popover.Trigger asChild><button type="button">指标 <b>{metrics.length}</b><Settings2 size={13}/></button></Popover.Trigger><Popover.Portal><Popover.Content className="expedition-picker" side="top" align="start" sideOffset={15} collisionPadding={15} aria-label="关注指标设置">
          <header><h3>关注指标</h3><Popover.Close asChild><button type="button" aria-label="关闭指标设置"><X size={17}/></button></Popover.Close></header>
          <label><Search size={14}/><input aria-label="搜索指标" placeholder="搜索指标" value={metricSearch} onChange={event => setMetricSearch(event.target.value)}/></label>
          <div className="expedition-picker-selected"><span>已选 {model.metricDraft.length} / 6</span>{model.metricDraft.map((id, position) => <div key={id}><Pin size={12}/><span>{metrics.find(item => item.id === id)?.name}</span><button type="button" aria-label="上移指标" disabled={position === 0} onClick={() => moveMetric(id, -1)}><ArrowUp size={12}/></button><button type="button" aria-label="下移指标" disabled={position === model.metricDraft.length - 1} onClick={() => moveMetric(id, 1)}><ArrowDown size={12}/></button></div>)}</div>
          <div className="expedition-picker-list">{metrics.filter(item => `${item.name} ${item.code}`.toLocaleLowerCase().includes(metricSearch.toLocaleLowerCase())).map(item => <label key={item.id}><input type="checkbox" checked={model.metricDraft.includes(item.id)} disabled={!model.metricDraft.includes(item.id) && model.metricDraft.length >= 6} onChange={() => selectMetric(item.id)}/><span>{item.name}</span><small>{item.unit}</small></label>)}</div>
          {model.preferenceError && <div role="alert">{model.preferenceError}</div>}
          <footer><button type="button" onClick={() => model.savePreference(true)}>恢复类型默认</button><button type="button" onClick={() => model.savePreference()}>保存</button></footer>
        </Popover.Content></Popover.Portal></Popover.Root></header>
        <ObservatoryAutoScroll className="expedition-reading-list" label="当前观测指标" paused={!props.motion.enabled} resetKey={`${props.device.device_id}:${model.nodeKey}:${selected.join(",")}`}>
          {visible.map(item => {
            const reading = results.get(item.id); const latest = seriesSummary(reading?.data?.series.find(data => data.data_stream_id === item.id)).latest;
            return <button type="button" key={item.id} aria-pressed={stream?.id === item.id} onClick={() => model.setFocusedChart(item.id)}><span>{item.name}</span><strong><AnimatedNumber value={latest?.value} enabled={props.motion.enabled}/><small>{item.unit}</small></strong></button>;
          })}
          {model.streams.error || model.nodes.error ? <div className="expedition-state" role="alert">{formatApiError(model.streams.error ?? model.nodes.error).message}</div> : model.streams.isLoading ? <div className="expedition-state" role="status">加载观测数据…</div> : !visible.length && <div className="expedition-state">{metrics.length ? "选择关注指标" : "暂无采集指标"}</div>}
        </ObservatoryAutoScroll>
      </section>
      {props.config.show_trends !== false && <section className="expedition-trend">
        <header className="expedition-section-title"><div><span>03 / TEMPORAL SIGNAL</span><h3>{stream?.name ?? "观测趋势"}<small>{stream?.unit}</small></h3></div><div className="expedition-chart-pagination"><button type="button" aria-label="上一指标" disabled={index === 0 || !visible.length} onClick={() => model.setFocusedChart(visible[index - 1].id)}><ChevronLeft size={16}/></button><span>{visible.length ? index + 1 : 0} / {visible.length}</span><button type="button" aria-label="下一指标" disabled={index >= visible.length - 1} onClick={() => model.setFocusedChart(visible[index + 1].id)}><ChevronRight size={16}/></button></div></header>
        <div className="expedition-chart" aria-label={stream ? `${stream.name}趋势图` : "观测趋势图"}>
          {!stream ? <div className="expedition-state">选择关注指标</div> : result?.isFetching && !series ? <div className="expedition-state" role="status">加载曲线…</div> : result?.error || series?.error ? <div className="expedition-state" role="alert">{series?.error ?? formatApiError(result?.error).message}</div> : !summary.points.length ? <div className="expedition-state">暂无数据</div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={summary.points.map(point => ({ time: Date.parse(point.ts), value: point.value }))} margin={{ top: 14, right: 18, bottom: 3, left: 0 }}>
            <defs><linearGradient id={`expedition-chart-${stream.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e6ad68" stopOpacity={.3}/><stop offset="100%" stopColor="#e6ad68" stopOpacity={.01}/></linearGradient></defs>
            <CartesianGrid stroke="#70604a" strokeOpacity={.38} strokeDasharray="2 7" vertical={false}/>
            <XAxis dataKey="time" type="number" domain={[Date.parse(range.start), Date.parse(range.end)]} tickFormatter={value => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#b4ab9a", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} tickCount={5}/>
            <YAxis width={52} domain={[summary.min! - domainPadding, summary.max! + domainPadding]} tickFormatter={numberLabel} tick={{ fill: "#b4ab9a", fontSize: 11 }} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{ background: "#171914", border: "1px solid #8a6942", color: "#f2e5d1", borderRadius: 0 }} labelFormatter={value => new Date(Number(value)).toLocaleString("zh-CN")}/>
            <Area key={`${stream.id}:${range.start}:${range.end}`} type="monotone" dataKey="value" name={stream.name} unit={stream.unit} stroke="#edb879" strokeWidth={2} fill={`url(#expedition-chart-${stream.id})`} dot={false} connectNulls={false} isAnimationActive={props.motion.enabled} animationDuration={500} animationEasing="ease-out"/>
          </AreaChart></ResponsiveContainer>}
        </div>
        <div className="expedition-chart-summary"><span>MIN <b>{numberLabel(summary.min)}</b></span><span>AVG <b>{numberLabel(summary.mean)}</b></span><span>MAX <b>{numberLabel(summary.max)}</b></span><time>{new Date(range.start).toLocaleDateString("zh-CN")} — {new Date(range.end).toLocaleDateString("zh-CN")}</time></div>
      </section>}
      {props.config.show_images !== false && <section className="expedition-media"><header className="expedition-section-title"><div><span>04 / FIELD IMAGERY</span><h3>现场影像</h3></div><button type="button" aria-pressed={asset} onClick={() => setAsset(!asset)}><Camera size={14}/>{asset ? "采集图片" : "资产照片"}</button></header><AtlasMedia key={`${model.nodeKey}:${asset}`} appearance="eco" workspaceId={props.workspaceId} deviceId={asset ? props.device.device_id : model.imageDevice} assetDeviceId={props.device.device_id} streams={imageStreams} restrictToStreams={restrictToStreams} range={range} asset={asset} pageSize={2}/></section>}
    </div>
  </section>;
}
