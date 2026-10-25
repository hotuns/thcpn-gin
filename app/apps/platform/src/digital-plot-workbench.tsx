import { useCallback, useEffect, useRef, useState } from "react";
import { Map, LngLatBounds, type StyleSpecification } from "maplibre-gl";
import Compare from "@maplibre/maplibre-gl-compare";
import "@maplibre/maplibre-gl-compare/style.css";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, SelectInput } from "./platform-ui";
import { hongliulin } from "./digital-plot-imagery";
import { flights, imageBounds, orthophoto, type Plot } from "./digital-plot-model";
import { createMapDraw, type MapDraw } from "./map-draw-session";
import { comparisonCanvas, downloadBlob, exportCanvas, geometryMeasure, validParcelRing } from "./map-tools-model";
import "./map-tools.css";

function imageryStyle(flightId: string, parcels: Plot[]): StyleSpecification {
  const flight = flights.find(f => f.id === flightId) ?? flights[2];
  return { version: 8, sources: {
    preview: { type: "image", url: orthophoto, coordinates: [[imageBounds[0], imageBounds[3]], [imageBounds[2], imageBounds[3]], [imageBounds[2], imageBounds[1]], [imageBounds[0], imageBounds[1]]] },
    aerial: { type: "raster", tiles: [hongliulin.tiles], bounds: [...imageBounds], scheme: "xyz", tileSize: 256, minzoom: hongliulin.minzoom, maxzoom: hongliulin.maxzoom, attribution: hongliulin.attribution },
    parcels: { type: "geojson", data: { type: "FeatureCollection", features: parcels.map(p => ({ type: "Feature", properties: { id: p.id }, geometry: { type: "Polygon", coordinates: [p.coordinates] } })) } },
  }, layers: [
    { id: "background", type: "background", paint: { "background-color": "#071b2b" } },
    ...(["preview", "aerial"] as const).map(id => ({ id, type: "raster" as const, source: id, paint: { "raster-saturation": flight.saturation, "raster-brightness-max": flight.brightness, "raster-fade-duration": 0 } })),
    { id: "parcel-fill", type: "fill", source: "parcels", paint: { "fill-color": "#3ec6ac", "fill-opacity": .08 } },
    { id: "parcel-line", type: "line", source: "parcels", paint: { "line-color": "#b8f2bb", "line-width": 2 } },
  ] };
}
export function DigitalPlotWorkbench({ mode, parcels, selected, onClose, onSave }: {
  mode: "edit" | "compare"; parcels: Plot[]; selected: string; onClose: () => void; onSave: (id: string, ring: number[][]) => void;
}) {
  const host = useRef<HTMLDivElement>(null); const beforeHost = useRef<HTMLDivElement>(null); const afterHost = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null); const afterMap = useRef<Map | null>(null); const draw = useRef<MapDraw | null>(null); const loaded = useRef(false);
  const [ready, setReady] = useState(false); const [error, setError] = useState(""); const [imageryWarning, setImageryWarning] = useState(""); const [measure, setMeasure] = useState("");
  const [tool, setTool] = useState("select"); const [before, setBefore] = useState<string>(flights[0].id); const [after, setAfter] = useState<string>(flights[2].id); const [split, setSplit] = useState(50);
  const comparison = useRef<Compare | null>(null); const [boundaries, setBoundaries] = useState(true); const [opacity, setOpacity] = useState(100);
  const [mounted, setMounted] = useState(false);
  const attach = useCallback((node: HTMLDivElement | null) => { host.current = node; setMounted(Boolean(node)); }, []);
  const current = useRef({ parcels, selected }); current.current = { parcels, selected };
  const splitRef = useRef(split); splitRef.current = split;
  const loadEditable = () => {
    const session = draw.current; if (!session) return;
    session.clear();
    const p = current.current.parcels.find(p => p.id === current.current.selected)!;
    const id = session.getFeatureId();
    const result = session.addFeatures([{ type: "Feature", id, properties: { mode: "polygon" }, geometry: { type: "Polygon", coordinates: [p.coordinates.map(point => point.map(v => Number(v.toFixed(9))))] } }]);
    if (result.some(r => !r.valid)) throw new Error(result.filter(r => !r.valid).map(r => r.reason).join("; "));
    session.setMode("select"); session.selectFeature(id); setTool("select");
  };
  useEffect(() => {
    if (!beforeHost.current || !host.current) return;
    let disposed = false; let watchdog: ReturnType<typeof setTimeout> | undefined;
    let readyCount = 0;
    const markReady = () => { if (++readyCount === (mode === "compare" ? 2 : 1)) { clearTimeout(watchdog); loaded.current = true; setReady(true); } };
    try {
      const init = { center: [(imageBounds[0] + imageBounds[2]) / 2, (imageBounds[1] + imageBounds[3]) / 2] as [number, number], zoom: 14, attributionControl: false as const, canvasContextAttributes: { preserveDrawingBuffer: true } };
      map.current = new Map({ ...init, container: beforeHost.current, style: imageryStyle(flights[0].id, parcels) });
      map.current.fitBounds(new LngLatBounds([imageBounds[0], imageBounds[1]], [imageBounds[2], imageBounds[3]]), { padding: 45, duration: 0 });
      watchdog = setTimeout(() => { if (!disposed && !loaded.current) setError("影像加载超时，请关闭后重新打开"); }, 20000);
      map.current.on("load", () => {
        if (disposed) return; markReady();
        if (mode === "edit") {
          try {
            draw.current = createMapDraw(map.current!);
            draw.current.on("change", () => setMeasure(draw.current?.getSnapshot().filter(f => !f.properties.midPoint && !f.properties.selectionPoint).map(f => geometryMeasure(f)).filter(Boolean).join(" / ") ?? ""));
            loadEditable();
          } catch (err) { setError(err instanceof Error ? err.message : "编辑器初始化失败"); }
        }
      });
      const failedImagery = new WeakSet<Map>();
      const handleError = (target: Map, sourceId?: string) => {
        if (disposed) return;
        if (sourceId === "aerial") {
          failedImagery.add(target);
          if (target.getLayer("preview")) target.setLayoutProperty("preview", "visibility", "visible");
          if (target.getLayer("aerial")) target.setLayoutProperty("aerial", "visibility", "none");
          setImageryWarning("在线正射瓦片暂不可用，已切换同区域本地预览。");
        } else setError("地图或本地影像加载失败，请检查网络后重试");
      };
      const hidePreviewWhenLoaded = (target: Map) => {
        target.on("sourcedata", event => {
          if (!disposed && !failedImagery.has(target) && event.sourceId === "aerial" && event.isSourceLoaded && target.getLayer("preview")) target.setLayoutProperty("preview", "visibility", "none");
        });
      };
      hidePreviewWhenLoaded(map.current);
      map.current.on("error", event => handleError(map.current!, "sourceId" in event ? String(event.sourceId) : undefined));
      if (mode === "compare" && afterHost.current) {
        afterMap.current = new Map({ ...init, container: afterHost.current, style: imageryStyle(flights[2].id, parcels) });
        afterMap.current.on("load", () => { if (!disposed) markReady(); });
        hidePreviewWhenLoaded(afterMap.current);
        afterMap.current.on("error", event => handleError(afterMap.current!, "sourceId" in event ? String(event.sourceId) : undefined));
        afterMap.current.jumpTo({ center: map.current.getCenter(), zoom: map.current.getZoom() });
        comparison.current = new Compare(map.current, afterMap.current, host.current);
        comparison.current.on("slideend", event => { if (!disposed && host.current) setSplit(Math.round(event.currentPosition / host.current.clientWidth * 100)); });
      }
      const observer = new ResizeObserver(() => { map.current?.resize(); afterMap.current?.resize(); comparison.current?.setSlider(host.current!.clientWidth * splitRef.current / 100); }); observer.observe(host.current);
      return () => { disposed = true; clearTimeout(watchdog); observer.disconnect(); draw.current?.stop(); draw.current = null; comparison.current?.remove(); comparison.current = null; map.current?.remove(); afterMap.current?.remove(); map.current = null; afterMap.current = null; loaded.current = false; };
    } catch (err) { disposed = true; clearTimeout(watchdog); setError(err instanceof Error ? err.message : "地图无法启动"); draw.current?.stop(); draw.current = null; comparison.current?.remove(); comparison.current = null; map.current?.remove(); afterMap.current?.remove(); map.current = null; afterMap.current = null; }
  }, [mode, mounted]);
  useEffect(() => {
    if (!ready) return;
    const apply = (target: Map | null, id: string) => { if (!target?.isStyleLoaded()) return; const flight = flights.find(f => f.id === id)!; for (const layer of ["preview", "aerial"]) { target.setPaintProperty(layer, "raster-saturation", flight.saturation); target.setPaintProperty(layer, "raster-brightness-max", flight.brightness); } };
    apply(map.current, before); apply(afterMap.current, after);
  }, [before, after, ready]);
  const choose = (value: string) => { setError(""); if (value === "select") { try { loadEditable(); } catch { setError("边界载入失败"); } } else { draw.current?.clear(); draw.current?.setMode(value); setTool(value); } };
  const save = () => {
    const polygons = draw.current?.getSnapshot().filter(f => f.geometry.type === "Polygon" && !f.properties.midPoint && !f.properties.selectionPoint) ?? [];
    const ring = polygons.length === 1 && polygons[0].geometry.type === "Polygon" ? polygons[0].geometry.coordinates[0] : null;
    if (!validParcelRing(ring)) { setError("请保留一个有效的闭合多边形，范围须在演示区域内，面积需大于 1㎡"); return; }
    try { onSave(selected, ring); onClose(); } catch { setError("无法保存本机演示数据，请检查浏览器存储权限"); }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="geo-workbench-dialog"><DialogHeader><DialogTitle>{mode === "edit" ? `${selected} · 样地边界与测量` : "无人机影像 · 地理卷帘对比"}</DialogTitle><DialogDescription>红柳林 mock 工作台：边界与设备为模拟，边界仅保存到当前浏览器；多期航次复用同一真实正射影像进行色调模拟，不代表实际变化。</DialogDescription></DialogHeader>
    <div className="geo-workbench-toolbar">{mode === "edit" ? <><Button variant="secondary" disabled={!ready} aria-pressed={tool === "select"} onClick={() => choose("select")}>编辑当前边界</Button><Button variant="secondary" disabled={!ready} aria-pressed={tool === "polygon"} onClick={() => choose("polygon")}>重绘边界 / 测面积</Button><Button variant="secondary" disabled={!ready} aria-pressed={tool === "linestring"} onClick={() => choose("linestring")}>测距离</Button><small>拖动顶点编辑；单击加点、双击完成</small></> : <><SelectInput aria-label="对比影像 A" value={before} onValueChange={setBefore}>{flights.map(f => <option key={f.id} value={f.id}>{f.date} · 模拟 A</option>)}</SelectInput><SelectInput aria-label="对比影像 B" value={after} onValueChange={setAfter}>{flights.map(f => <option key={f.id} value={f.id}>{f.date} · 模拟 B</option>)}</SelectInput><label>卷帘位置<Input aria-label="影像卷帘位置" type="range" min={0} max={100} value={split} onChange={e => { const next = Number(e.target.value); setSplit(next); comparison.current?.setSlider(host.current!.clientWidth * next / 100); }} /></label></>}
    <Button variant="ghost" disabled={!ready} onClick={() => { const next = !boundaries; setBoundaries(next); for (const m of [map.current, afterMap.current]) if (m?.isStyleLoaded()) for (const id of ["parcel-line", "parcel-fill"]) m.setLayoutProperty(id, "visibility", next ? "visible" : "none"); }}>边界{boundaries ? "：开" : "：关"}</Button><label>影像透明度<Input aria-label="影像透明度" type="range" min={0} max={100} value={opacity} onChange={e => { setOpacity(Number(e.target.value)); for (const m of [map.current, afterMap.current]) if (m?.isStyleLoaded()) for (const layer of ["preview", "aerial"]) m.setPaintProperty(layer, "raster-opacity", Number(e.target.value) / 100); }} /></label></div>
    <div className="geo-workbench-map" ref={attach}><div className="geo-map" ref={beforeHost} />{mode === "compare" && <><div className="geo-map" ref={afterHost} /><span className="geo-flight-label is-before">A · {flights.find(f => f.id === before)?.date} · 模拟</span><span className="geo-flight-label is-after">B · {flights.find(f => f.id === after)?.date} · 模拟</span></>}</div>
    {imageryWarning && <p role="status">{imageryWarning}</p>}{error && <p role="alert">{error}</p>}<footer><output aria-live="polite">{ready ? measure || "影像：红柳林 · 用户提供；边界/设备/指标为 mock" : "正在加载地图…"}</output><div className="geo-workbench-toolbar"><Button variant="secondary" disabled={!ready} onClick={async () => { try { await exportCanvas(mode === "compare" && afterMap.current ? comparisonCanvas(map.current!.getCanvas(), afterMap.current.getCanvas(), split) : map.current!.getCanvas(), "digital-plot-map.png", "红柳林数字样地 · mock 数据 · 用户提供正射影像"); } catch { setError("截图失败，影像资源不可导出"); } }}>导出当前地图 PNG</Button>{mode === "edit" && <><Button variant="secondary" onClick={() => downloadBlob(new Blob([JSON.stringify({ type: "FeatureCollection", features: parcels.map(p => ({ type: "Feature", properties: { id: p.id, demo: true, region: hongliulin.id }, geometry: { type: "Polygon", coordinates: [p.coordinates] } })) }, null, 2)], { type: "application/geo+json" }), "demo-parcels.geojson")}>导出 GeoJSON</Button><Button disabled={!ready || tool === "linestring"} onClick={save}>保存演示边界</Button></>}</div></footer>
  </DialogContent></Dialog>;
}
