import "../../app/apps/platform/src/platform.css";
import "../../app/apps/platform/src/shadcn.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../app/packages/i18n/src/index";
import { ObservatoryMasthead, ObservatoryPanelFrame, ObservatoryTitle } from "../../app/apps/platform/src/observatory-decoration";
import { atlasTemplate } from "../../app/apps/platform/src/atlas-templates";
import { AtlasClock } from "../../app/apps/platform/src/atlas-clock";
import { ObservatoryAutoScroll, ObservatoryMotionToggle, useObservatoryMotion } from "../../app/apps/platform/src/observatory-motion";
import "../../app/apps/platform/src/atlas.css";
import "../../app/apps/platform/src/atlas-templates.css";
import "../../app/apps/platform/src/digital-plot.css";
import "../../app/apps/platform/src/observatory.css";
import "../../app/apps/platform/src/observatory-decoration.css";
import "./review.css";

function Preview() {
  const motion=useObservatoryMotion();
  const [mode, setMode] = useState("technology");
  const Layout=atlasTemplate(mode).Layout;
  const health = <section className="atlas-summary atlas-health"><ObservatoryPanelFrame /><header><strong>设备运行概况</strong><small>近 24 小时</small></header><div className="atlas-health-grid">{["设备总数", "正常上报", "上报超时", "状态未知"].map((label, i) => <div key={label} className={`atlas-health-count is-${["total", "normal", "overdue", "unknown"][i]}`}><span>{label}</span><strong>—</strong></div>)}</div><footer>装饰预览 · 未连接业务数据</footer></section>;
  const panel = (name: string) => <><ObservatoryPanelFrame /><header><h2>{name}</h2></header><div className="preview-panel-note">该区域沿用现有{name}功能。<br />此页仅用于检查组件、尺寸和布局。</div></>;
  const directory=<aside className="atlas-directory"><ObservatoryPanelFrame/><header><h2>设备列表</h2></header><ObservatoryAutoScroll className="atlas-device-list" label="设备列表" paused={!motion.enabled}>{Array.from({length:14},(_,index)=><button key={index} className="atlas-device-row"><span>{String(index+1).padStart(2,"0")}</span><span><strong>演示观测站 {index+1}</strong><small>MOCK-{1000+index}</small><em>仅用于动效核验</em></span></button>)}</ObservatoryAutoScroll></aside>;
  return <>
    <nav className="preview-nav"><strong>DataV / 一张图组件预览</strong><div>{[["technology", "数据指挥台"], ["panorama", "空间态势"], ["plot", "数字样地"]].map(([value, label]) => <button key={value} onClick={() => setMode(value)} aria-pressed={mode === value}>{label}</button>)}</div></nav>
    {mode === "plot" ? <div className="digital-plot" data-observatory-motion={motion.enabled ? "running":"paused"}><header className="dp-header"><ObservatoryMasthead /><span className="dp-back">专题定制</span><ObservatoryTitle className="dp-title" title="数字样地" /><div className="dp-header-tools"><AtlasClock /><ObservatoryMotionToggle motion={motion}/><button onClick={() => void document.documentElement.requestFullscreen()}>⛶</button></div></header><div className="dp-scene"><aside className="dp-panel dp-directory">{panel("样地目录")}</aside><div className="preview-map">地图与地块可视化区域</div><aside className="dp-panel dp-inspector">{panel("样地观测")}</aside></div><section className="dp-panel dp-playback">{panel("历史时间轴")}</section></div>
      : <div className={`atlas-shell atlas-layout-balanced atlas-template-${mode}`} data-observatory-motion={motion.enabled ? "running":"paused"}><div className="atlas-topbar"><ObservatoryMasthead /><header className="atlas-header"><ObservatoryTitle className="atlas-title" title="生态观测一张图" description={mode === "technology" ? "生态环境观测网络" : undefined} /></header>{mode === "panorama" && health}<div className="atlas-header-actions"><AtlasClock /><ObservatoryMotionToggle motion={motion}/><button aria-label="全屏" onClick={() => void document.documentElement.requestFullscreen()}>⛶</button></div></div><Layout summary={mode === "technology" ? health : undefined} directory={directory} map={<section className="atlas-map-region preview-map">地图观测区域</section>} inspector={<aside className="atlas-inspector">{panel("指标与影像")}</aside>}/></div>}
    <footer className="preview-provenance">复用 DataV-React Decoration 5 / 8 / 11、BorderBox 13 · MIT · 此页不展示真实设备数据</footer>
  </>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Preview /></I18nProvider>);
