import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Maximize2, Minimize2, Pause, Play, Settings2 } from "lucide-react";
import type { AtlasScreenProps } from "./atlas-screen-props";
import { EcoDirectory } from "./eco-directory";
import { EcoDeviceInspector } from "./eco-device";
import "./eco-screen.css";
import "./eco-motion.css";
import "./eco-palette.css";
import { useSceneReveal } from "../../shared/hooks/use-scene-reveal";

type Props = AtlasScreenProps;

/** Deep blue is a complete presentation, with no legacy atlas visual wrappers. */
export function EcoScreen(props: Props) {
  const revealed = useSceneReveal();
  return <div className={`eco-screen${props.presenting ? " eco-presenting" : ""}${props.config.layout === "map" ? " eco-map-priority" : ""}`} data-observatory-motion={props.motion.enabled ? "running" : "paused"}>
    <div className="eco-map-stage">{props.map}</div>
    <header className="eco-masthead">
      <svg className="eco-header-traces" viewBox="0 0 1672 80" preserveAspectRatio="none" aria-hidden="true">
        <defs><filter id="eco-trace-glow"><feGaussianBlur stdDeviation="2" /></filter></defs>
        <path className="eco-trace-halo" d="M0 53H245L270 33H538L575 62H615L633 75H1039L1057 62H1097L1134 33H1402L1427 53H1672"/>
        <path d="M0 53H245L270 33H538L575 62H615L633 75H1039L1057 62H1097L1134 33H1402L1427 53H1672"/>
        <path className="eco-trace-secondary" d="M0 59H247L273 39H536L573 68H612M1060 68H1099L1136 39H1400L1425 59H1672"/>
        <path className="eco-trace-upper" d="M280 26H530L565 52H594M1078 52H1107L1142 26H1392"/>
        {[0,1,2,3].map(index => <g key={index}><path className="eco-header-slash" d={`M${267+index*14} 24h10l-11 12h-10z`}/><path className="eco-header-slash" d={`M${1345+index*14} 24h10l11 12h-10z`}/></g>)}
      </svg>
      <div className="eco-brand">生态感知 · 全域协同</div>
      <nav className="eco-maintenance" aria-label="大屏操作">
        <button type="button" onClick={props.onBack} aria-label="返回一张图管理" title="返回管理"><ArrowLeft size={18}/></button>
        {props.canManage && <button type="button" onClick={props.onEdit} aria-label="编辑大屏" title="编辑大屏"><Settings2 size={18}/></button>}
        <button type="button" onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")} aria-label="新窗口打开" title="新窗口打开"><ExternalLink size={17}/></button>
        <button type="button" onClick={props.motion.toggle} disabled={props.motion.reduced} aria-label={props.motion.paused ? "播放动画" : "暂停动画"} title={props.motion.paused ? "播放动画" : "暂停动画"}>{props.motion.paused ? <Play size={17}/> : <Pause size={17}/>}</button>
      </nav>
      <div className={`eco-heading t-stagger${revealed || !props.motion.enabled ? " is-shown" : ""}`}><h1 className="t-stagger-line t-stagger-line--1">{props.title}</h1><p className="t-stagger-line t-stagger-line--2">ECOLOGICAL OBSERVATION</p></div>
      <div className="eco-header-right"><EcoClock/><button type="button" onClick={props.onFullscreen} aria-label={props.presenting ? "退出全屏" : "全屏"} title={props.presenting ? "退出全屏" : "全屏"}>{props.presenting ? <Minimize2 size={23}/> : <Maximize2 size={23}/>}</button></div>
    </header>
    <div className="eco-left-column"><EcoDirectory motionEnabled={props.motion.enabled} revealed={revealed} workspaceId={props.workspaceId} devices={props.devices} selectedDevice={props.selectedDevice} selectedNodeKey={props.selectedNodeKey} onSelect={props.onSelect} onSelectNode={props.onSelectNode} kind={props.kind} onKindChange={props.onKindChange} scoped={!!props.config.device_ids?.length}/></div>
    {props.selectedDevice ? <EcoDeviceInspector motionEnabled={props.motion.enabled} revealed={revealed} key={props.selectedDevice.device_id} device={props.selectedDevice} workspaceId={props.workspaceId} boardId={props.boardId} config={props.config} selectedNodeKey={props.selectedNodeKey} onNodeChange={props.onSelectNode}/> : <section className="eco-panel eco-inspector eco-empty-inspector"><h2 className="eco-panel-title">设备采集数据</h2><span>选择设备</span></section>}
    <div className="eco-map-legend" aria-label="地图图例"><span><i className="eco-legend-gateway"/>网关（组网）</span><span><i className="eco-legend-node"/>节点（传感器）</span><span><i className="eco-legend-link"/>数据链路（LoRa）</span></div>
    {props.warning && <div className="eco-screen-warning" role="alert">{props.warning}</div>}
    {props.settings}
  </div>;
}

function EcoClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const interval = window.setInterval(() => setNow(new Date()), 1000); return () => clearInterval(interval); }, []);
  const date = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,"0")}.${String(now.getDate()).padStart(2,"0")}`;
  return <time className="eco-clock" dateTime={now.toISOString()}>{date}<span>{now.toLocaleTimeString("zh-CN", { hour12:false })}</span></time>;
}
