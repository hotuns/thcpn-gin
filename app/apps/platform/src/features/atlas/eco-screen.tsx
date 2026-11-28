import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Compass,
  ExternalLink,
  Layers3,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RadioTower,
  Settings2,
} from "lucide-react";
import type { AtlasScreenProps } from "./atlas-screen-props";
import { EcoDirectory } from "./eco-directory";
import { EcoDeviceInspector } from "./eco-device";
import { AtlasFilmstrip } from "./atlas-filmstrip";
import { located } from "./atlas-model";
import { useSceneReveal } from "../../shared/hooks/use-scene-reveal";
import "./eco-palette.css";
import "./eco-screen.css";
import "./eco-motion.css";

type Props = AtlasScreenProps;
type MobilePane = "map" | "directory" | "inspector";

/** Canopy Spatial Observatory — unified flagship Atlas presentation. */
export function EcoScreen(props: Props) {
  const revealed = useSceneReveal();
  const [hudCollapsed, setHudCollapsed] = useState(() => props.config.layout === "map");
  const [mobilePane, setMobilePane] = useState<MobilePane>("map");
  const [hours, setHours] = useState(() => props.config.trend_hours ?? 24);
  const [filmstripOpen, setFilmstripOpen] = useState(false);

  useEffect(() => {
    setHudCollapsed(props.config.layout === "map");
  }, [props.config.layout]);

  useEffect(() => {
    if (props.config.trend_hours) setHours(props.config.trend_hours);
  }, [props.config.trend_hours]);

  const selected = props.selectedDevice;
  const hasFilmstrip = Boolean(selected && props.config.show_images !== false);
  const hasCoords = selected ? located(selected) : false;
  const coordLabel = hasCoords
    ? `${Math.abs(selected!.latitude!).toFixed(4)}°${selected!.latitude! >= 0 ? "N" : "S"} · ${Math.abs(selected!.longitude!).toFixed(4)}°${selected!.longitude! >= 0 ? "E" : "W"}`
    : selected?.asset_no || "全域生态监测网络";

  return (
    <div
      className={`eco-screen${props.presenting ? " eco-presenting" : ""}${hudCollapsed ? " eco-map-priority" : ""}`}
      data-observatory-motion={props.motion.enabled ? "running" : "paused"}
      data-mobile-pane={mobilePane}
      data-revealed={revealed || !props.motion.enabled ? "true" : "false"}
      data-has-filmstrip={hasFilmstrip ? "true" : "false"}
      data-filmstrip-open={hasFilmstrip && filmstripOpen ? "true" : "false"}
    >
      <div className="eco-map-stage">{props.map}</div>
      <div className="obs-vignette" aria-hidden="true" />

      {/* Top Floating Command Capsule */}
      <header className={`eco-masthead${revealed || !props.motion.enabled ? " is-revealed" : ""}`}>
        <div className="obs-masthead-left">
          <button
            type="button"
            className="obs-icon-btn"
            onClick={props.onBack}
            aria-label={props.backLabel}
            title={props.backLabel}
          >
            <ArrowLeft size={17} />
          </button>
          <div className="obs-live-badge" aria-hidden="true">
            <span className="obs-live-dot" />
          </div>
          <div className={`eco-heading t-stagger${revealed || !props.motion.enabled ? " is-shown" : ""}`}>
            <h1 className="t-stagger-line t-stagger-line--1">{props.title}</h1>
            <p className="t-stagger-line t-stagger-line--2">
              <Compass size={11} aria-hidden="true" />
              <span key={selected?.device_id ?? "global"} className="obs-coord-swap">
                {selected ? `${selected.name} · ${coordLabel}` : "CANOPY SPATIAL OBSERVATORY"}
              </span>
            </p>
          </div>
        </div>

        <div className="eco-header-right">
          <EcoClock />
          <div className="obs-divider" aria-hidden="true" />
          <nav className="eco-maintenance" aria-label="大屏操作">
            <button
              type="button"
              className={`obs-icon-btn${hudCollapsed ? " is-active" : ""}`}
              aria-pressed={hudCollapsed}
              onClick={() => setHudCollapsed((current) => !current)}
              aria-label={hudCollapsed ? "展开观测面板" : "地图专注模式"}
              title={hudCollapsed ? "展开观测面板" : "地图专注模式"}
            >
              {hudCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            {props.canManage && (
              <button
                type="button"
                className="obs-icon-btn"
                onClick={props.onEdit}
                aria-label="编辑大屏"
                title="编辑大屏"
              >
                <Settings2 size={16} />
              </button>
            )}
            <button
              type="button"
              className="obs-icon-btn"
              onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
              aria-label="新窗口打开"
              title="新窗口打开"
            >
              <ExternalLink size={15} />
            </button>
            <button
              type="button"
              className="obs-icon-btn"
              onClick={props.motion.toggle}
              disabled={props.motion.reduced}
              aria-label={props.motion.paused ? "播放动画" : "暂停动画"}
              title={props.motion.paused ? "播放动画" : "暂停动画"}
            >
              {props.motion.paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <button
              type="button"
              className="obs-icon-btn"
              onClick={props.onFullscreen}
              aria-label={props.presenting ? "退出全屏" : "全屏"}
              title={props.presenting ? "退出全屏" : "全屏"}
            >
              {props.presenting ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </nav>
        </div>
      </header>

      {/* Left Floating Station & Network Deck */}
      <div className="eco-left-column" data-collapsed={hudCollapsed}>
        <EcoDirectory
          motionEnabled={props.motion.enabled}
          revealed={revealed}
          workspaceId={props.workspaceId}
          devices={props.devices}
          selectedDevice={props.selectedDevice}
          selectedNodeKey={props.selectedNodeKey}
          onSelect={(id) => {
            props.onSelect(id);
            if (mobilePane === "directory") setMobilePane("inspector");
          }}
          onSelectNode={props.onSelectNode}
          kind={props.kind}
          onKindChange={props.onKindChange}
          scoped={!!props.config.device_ids?.length}
        />
      </div>

      {/* Right Floating Observation & Telemetry Deck */}
      <div className="eco-right-column" data-collapsed={hudCollapsed}>
        {props.selectedDevice ? (
          <EcoDeviceInspector
            motionEnabled={props.motion.enabled}
            revealed={revealed}
            key={props.selectedDevice.device_id}
            device={props.selectedDevice}
            workspaceId={props.workspaceId}
            boardId={props.boardId}
            config={props.config}
            selectedNodeKey={props.selectedNodeKey}
            onNodeChange={props.onSelectNode}
            hours={hours}
            onHoursChange={setHours}
          />
        ) : (
          <section className="eco-panel eco-inspector eco-empty-inspector">
            <h2 className="eco-panel-title">设备采集数据</h2>
            <div className="obs-empty-hint">
              <RadioTower size={28} strokeWidth={1.4} />
              <span>从左侧目录或地图点位选择设备</span>
            </div>
          </section>
        )}
      </div>

      {/* Bottom Collapsible Horizontal Imagery Filmstrip */}
      {props.selectedDevice && props.config.show_images !== false && (
        <AtlasFilmstrip
          workspaceId={props.workspaceId}
          device={props.selectedDevice}
          selectedNodeKey={props.selectedNodeKey}
          hours={hours}
          open={filmstripOpen}
          onOpenChange={setFilmstripOpen}
          hudCollapsed={hudCollapsed}
          motionEnabled={props.motion.enabled}
        />
      )}

      {/* Bottom Floating Spatial Legend */}
      <div className="eco-map-legend" aria-label="地图图例">
        <span><i className="eco-legend-gateway" />网关</span>
        <span><i className="eco-legend-node" />节点</span>
        <span><i className="eco-legend-link" />LoRa 链路</span>
      </div>

      {/* Mobile Floating Dock */}
      <nav className="obs-mobile-dock" aria-label="视图切换">
        <button
          type="button"
          aria-pressed={mobilePane === "map"}
          onClick={() => setMobilePane("map")}
        >
          <MapIcon size={16} />
          <span>地图</span>
        </button>
        <button
          type="button"
          aria-pressed={mobilePane === "directory"}
          onClick={() => setMobilePane("directory")}
        >
          <Layers3 size={16} />
          <span>站点</span>
        </button>
        <button
          type="button"
          aria-pressed={mobilePane === "inspector"}
          onClick={() => setMobilePane("inspector")}
        >
          <Activity size={16} />
          <span>观测</span>
        </button>
      </nav>

      {props.warning && (
        <div className="eco-screen-warning" role="alert">
          {props.warning}
        </div>
      )}
      {props.settings}
    </div>
  );
}

function EcoClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
  return (
    <time className="eco-clock" dateTime={now.toISOString()}>
      <small>{date}</small>
      <span>{now.toLocaleTimeString("zh-CN", { hour12: false })}</span>
    </time>
  );
}
