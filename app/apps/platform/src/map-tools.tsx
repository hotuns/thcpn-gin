import { useEffect, useRef, useState } from "react";
import type { Map } from "maplibre-gl";
import { Download, Layers3, Ruler, Shapes, X } from "lucide-react";
import { deviceKinds, deviceKindLabels, deviceSymbolSvg, symbolStates, type SymbolState } from "@thcpn/device-map";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Switch, Input } from "./platform-ui";
import { exportCanvas, geometryMeasure, mapSourceCredit } from "./map-tools-model";
import type { MapDraw } from "./map-draw-session";
import "./map-tools.css";

export function MapTools({ map }: { map: Map | null }) {
  const [open, setOpen] = useState(false); const [legend, setLegend] = useState(false);
  const [mode, setMode] = useState(""); const [measure, setMeasure] = useState(""); const [error, setError] = useState("");
  const [layers, setLayers] = useState<{ id: string; name: string; layerIds: string[]; type: string; visible: boolean; opacity: number }[]>([]);
  const draw = useRef<MapDraw | null>(null); const pending = useRef(0);
  useEffect(() => () => { pending.current++; draw.current?.stop(); draw.current = null; }, [map]);
  const refreshLayers = () => {
    const all = map?.getStyle().layers ?? [];
    const raster = all.filter(l => l.type === "raster").map(l => ({ id: l.id, name: l.id.includes("imagery") || l.id === "satellite" ? "卫星影像" : l.id.includes("labels") ? "地名标注" : l.id, layerIds: [l.id], type: l.type, visible: map!.getLayoutProperty(l.id, "visibility") !== "none", opacity: Number(map!.getPaintProperty(l.id, "raster-opacity") ?? 1) }));
    const devices = all.filter(l => l.id.startsWith("eco-device")).map(l => l.id);
    setLayers([...raster, ...(devices.length ? [{ id: "devices", name: "设备点位", layerIds: devices, type: "symbol", visible: devices.some(id => map!.getLayoutProperty(id, "visibility") !== "none"), opacity: 1 }] : [])]);
  };
  const start = async (next: string) => {
    if (!map?.getStyle()?.layers) return;
    const request = ++pending.current; setError("");
    try {
      if (!draw.current) {
        const { createMapDraw } = await import("./map-draw-session");
        if (request !== pending.current) return;
        draw.current = createMapDraw(map);
        draw.current.on("change", () => {
          const features = draw.current?.getSnapshot().filter(f => !f.properties.midPoint && !f.properties.selectionPoint) ?? [];
          setMeasure(features.map(f => geometryMeasure(f)).filter(Boolean).join(" / "));
        });
      }
      draw.current.setMode(next); setMode(next);
    } catch { setError("绘制工具初始化失败，请关闭后重试"); }
  };
  const stop = () => { pending.current++; draw.current?.stop(); draw.current = null; setMode(""); setMeasure(""); };
  return <div className="map-tools" aria-label="地图工具">
    <Button variant="secondary" aria-label="地图工具" title="地图工具" disabled={!map} onClick={() => { if (open) stop(); setOpen(v => !v); refreshLayers(); }}><Layers3 size={17} /></Button>
    {open && <section className="map-tools-panel">
      <header><strong>地图工具</strong><Button variant="ghost" aria-label="关闭地图工具" onClick={() => { setOpen(false); stop(); }}><X size={14} /></Button></header>
      <div className="map-tools-actions"><Button variant="secondary" aria-pressed={mode === "linestring"} onClick={() => void start("linestring")}><Ruler size={14} />测距离</Button><Button variant="secondary" aria-pressed={mode === "polygon"} onClick={() => void start("polygon")}><Shapes size={14} />测面积</Button></div>
      {mode && <><small>单击添加点，双击结束；测量为地表估算，不作为测绘依据。</small><output aria-live="polite">{measure || "请在地图上绘制"}</output><Button variant="ghost" onClick={stop}>结束并清除测量</Button></>}
      <h3>图层与透明度</h3>
      {layers.map(l => <div className="map-tools-layer" key={l.id}><label><Switch aria-label={`显示 ${l.name}`} checked={l.visible} onCheckedChange={value => { for (const id of l.layerIds) map!.setLayoutProperty(id, "visibility", value ? "visible" : "none"); refreshLayers(); }} /><span>{l.name}</span></label>{l.type === "raster" && <Input aria-label={`${l.name} 透明度`} type="range" min={0} max={100} value={Math.round(l.opacity * 100)} onChange={e => { map!.setPaintProperty(l.id, "raster-opacity", Number(e.target.value) / 100); refreshLayers(); }} />}</div>)}
      <Button variant="secondary" onClick={() => { try { map!.triggerRepaint(); map!.once("render", async () => { try { await exportCanvas(map!.getCanvas(), "ecocloud-map.png", `In-situ EcoCloud · ${mapSourceCredit(map!.getStyle())}`); } catch { setError("截图失败：底图资源不允许跨域导出"); } }); } catch { setError("地图尚未准备就绪"); } }}><Download size={14} />导出地图 PNG</Button>
      <Button variant="ghost" onClick={() => setLegend(true)}>设备图标图例</Button>
      {error && <p role="alert">{error}</p>}
    </section>}
    <Dialog open={legend} onOpenChange={setLegend}><DialogContent className="map-symbol-dialog"><DialogHeader><DialogTitle>设备图标规范</DialogTitle></DialogHeader><p>轮廓和符号表示设备类别，右上角表示资产状态；启用不等于在线。青色双边框表示选中。</p><div className="map-symbol-gallery">{deviceKinds.map(kind => <div key={kind}><img alt={deviceKindLabels[kind]} src={`data:image/svg+xml,${encodeURIComponent(deviceSymbolSvg(kind, "active"))}`} /><strong>{deviceKindLabels[kind]}</strong></div>)}</div><div className="map-symbol-status">{Object.entries(symbolStates).map(([state, meta]) => <div key={state}><img alt="" src={`data:image/svg+xml,${encodeURIComponent(deviceSymbolSvg("gateway", state as SymbolState))}`} /><span>{meta.label}</span></div>)}<div><img alt="" src={`data:image/svg+xml,${encodeURIComponent(deviceSymbolSvg("gateway", "active", true))}`} /><span>当前选中</span></div></div></DialogContent></Dialog>
  </div>;
}
