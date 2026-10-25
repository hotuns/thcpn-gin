import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { NativeDeviceLayer } from "./native-device-layer";
export * from "./device-symbols";
export { NativeDeviceLayer } from "./native-device-layer";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

export type DeviceMapPoint = { device_id: string; name: string; device_type: string; status: string; latitude?: number; longitude?: number; child_count?: number; ecosystem?: string; category_icon?: string; purposes?: string[] };

export function iconifyIconUrl(icon?: string, color = "#176f58") {
  const match = icon?.trim().match(/^([a-z0-9-]+):([a-z0-9-]+)$/);
  return match ? `https://api.iconify.design/${match[1]}/${match[2]}.svg?color=${encodeURIComponent(color)}` : "";
}

export function tiandituImageryStyle(token: string): StyleSpecification {
  const tiles = (layer: "img" | "cia") => Array.from({ length: 8 }, (_, index) =>
    `https://t${index}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${encodeURIComponent(token)}`,
  );
  return {
    version: 8,
    sources: {
      imagery: { type: "raster", tiles: tiles("img"), tileSize: 256, attribution: "天地图 GS(2024)0650号" },
      labels: { type: "raster", tiles: tiles("cia"), tileSize: 256 },
    },
    layers: [
      { id: "tianditu-imagery", type: "raster", source: "imagery" },
      { id: "tianditu-labels", type: "raster", source: "labels" },
    ],
  };
}

function defaultStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}

export function DeviceMap({ points, onSelect, selectedDeviceId, height = 520, styleUrl, mapStyle, showNavigation = true, onMapReady }: { points: DeviceMapPoint[]; onSelect?: (id: string) => void; selectedDeviceId?: string; height?: number | string; styleUrl?: string; mapStyle?: StyleSpecification; showNavigation?: boolean; onMapReady?: (map: MapLibreMap | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const layer = useRef<NativeDeviceLayer | null>(null);
  const current = useRef({ points, selectedDeviceId, onSelect, onMapReady });
  current.current = { points, selectedDeviceId, onSelect, onMapReady };
  const cameraState = useRef<{ map: MapLibreMap; locations: string; selected?: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!container.current) return;
    setError("");
    const instance = new maplibregl.Map({ container: container.current, style: mapStyle || styleUrl || defaultStyle(), center: [104, 35], zoom: 3, attributionControl: {}, canvasContextAttributes: { preserveDrawingBuffer: true } });
    map.current = instance;
    layer.current = new NativeDeviceLayer(instance, id => current.current.onSelect?.(id), setError);
    layer.current.update(current.current.points, current.current.selectedDeviceId);
    instance.on("load", () => current.current.onMapReady?.(instance));
    if (showNavigation) instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    fit(instance, current.current.points);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); current.current.onMapReady?.(null); layer.current?.dispose(); layer.current = null; instance.remove(); map.current = null; };
  }, [styleUrl, mapStyle, showNavigation]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    layer.current?.update(points, selectedDeviceId);
    const located = locatedPoints(points);
    const locations = JSON.stringify(located.map(p => [p.device_id, p.longitude, p.latitude]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
    const previous = cameraState.current;
    const selected = located.find(p => p.device_id === selectedDeviceId);
    if (selected && (previous?.map !== instance || previous.selected !== selectedDeviceId || previous.locations !== locations)) instance.easeTo({ center: [selected.longitude!, selected.latitude!] });
    else if (!selectedDeviceId && (previous?.map !== instance || previous.locations !== locations)) fit(instance, points);
    cameraState.current = { map: instance, locations, selected: selectedDeviceId };
  }, [points, selectedDeviceId, styleUrl, mapStyle, showNavigation]);
  return <div className="device-map-host" style={{ height }}>
    <div ref={container} className="device-map-canvas" style={{ height: "100%" }} />
    {error && <div className="device-map-symbol-error" role="alert">{error}</div>}
    <div className="device-map-accessible-list" aria-label="地图设备列表">{locatedPoints(points).map(p => <button key={p.device_id} aria-pressed={selectedDeviceId === p.device_id} onFocus={() => map.current?.easeTo({ center: [p.longitude!, p.latitude!] })} onClick={() => onSelect?.(p.device_id)}>{p.name}</button>)}</div>
  </div>;
}

export function LocationPicker({ latitude, longitude, onChange, height = 280, styleUrl }: { latitude?: number; longitude?: number; onChange: (location: { latitude: number; longitude: number }) => void; height?: number; styleUrl?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    if (!container.current || map.current) return;
    const hasLocation = latitude !== undefined && longitude !== undefined;
    const instance = new maplibregl.Map({ container: container.current, style: styleUrl || defaultStyle(), center: hasLocation ? [longitude, latitude] : [104, 35], zoom: hasLocation ? 13 : 3, attributionControl: {} });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const place = (lng: number, lat: number) => {
      if (!marker.current) {
        marker.current = new maplibregl.Marker({ draggable: true }).setLngLat([lng, lat]).addTo(instance);
        marker.current.on("dragend", () => { const point = marker.current!.getLngLat(); onChange({ latitude: point.lat, longitude: point.lng }); });
      } else marker.current.setLngLat([lng, lat]);
    };
    if (hasLocation) place(longitude, latitude);
    instance.on("click", (event) => { place(event.lngLat.lng, event.lngLat.lat); onChange({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }); });
    return () => { marker.current?.remove(); marker.current = null; instance.remove(); map.current = null; };
  }, [styleUrl]);
  useEffect(() => {
    if (latitude === undefined || longitude === undefined || !map.current) return;
    if (!marker.current) {
      marker.current = new maplibregl.Marker({ draggable: true }).setLngLat([longitude, latitude]).addTo(map.current);
      marker.current.on("dragend", () => { const point = marker.current!.getLngLat(); onChange({ latitude: point.lat, longitude: point.lng }); });
    }
    else marker.current.setLngLat([longitude, latitude]);
  }, [latitude, longitude, onChange]);
  return <div ref={container} className="device-map-canvas location-picker-canvas" style={{ height }} aria-label="设备位置地图" />;
}

function locatedPoints(points: DeviceMapPoint[]) {
  return points.filter((point) =>
    typeof point.latitude === "number"
    && Number.isFinite(point.latitude)
    && typeof point.longitude === "number"
    && Number.isFinite(point.longitude));
}

function fit(map: MapLibreMap, points: DeviceMapPoint[]) { const located = locatedPoints(points); if (!located.length) return; const bounds = new maplibregl.LngLatBounds(); located.forEach((p) => bounds.extend([p.longitude!, p.latitude!])); if (located.length === 1) map.easeTo({ center: bounds.getCenter(), zoom: 12 }); else map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 0 }); }
