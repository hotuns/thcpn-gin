import type { Map, GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import { Popup } from "maplibre-gl";
import { deviceKind, deviceSymbolId, deviceSymbolSvg, rasterizeDeviceSymbol, symbolState } from "./device-symbols";
import type { DeviceMapPoint } from "./index";

export const deviceLayerIds = { source: "eco-devices", cluster: "eco-device-clusters", count: "eco-device-count", symbol: "eco-device-symbols", halo: "eco-device-halo" };
export function deviceSymbolFeatures(points: DeviceMapPoint[], selected?: string) {
  return { type: "FeatureCollection" as const, features: points.filter(p => Number.isFinite(p.longitude) && Number.isFinite(p.latitude) && Math.abs(p.latitude!) <= 90 && Math.abs(p.longitude!) <= 180).map(p => ({
    type: "Feature" as const, id: p.device_id, geometry: { type: "Point" as const, coordinates: [p.longitude!, p.latitude!] },
    properties: { device_id: p.device_id, name: p.name, selected: p.device_id === selected, icon: deviceSymbolId(p.device_type, p.status, p.device_id === selected) },
  })) };
}
/** Native symbol/circle layers share the basemap render frame: no DOM transform lag. */
export class NativeDeviceLayer {
  private disposed = false;
  private pending = new Set<string>();
  private initialized = false;
  private points: DeviceMapPoint[] = [];
  private selected?: string;
  private popup?: Popup;
  constructor(private map: Map, private onSelect: (id: string) => void, private onError?: (message: string) => void) {
    map.on("load", this.initialize);
    map.on("styledata", this.initialize);
    if (map.isStyleLoaded?.() || map.getStyle?.()?.version === 8) this.initialize();
  }
  update(points: DeviceMapPoint[], selected?: string) { this.points = points; this.selected = selected; if (this.initialized) this.render(); }
  private initialize = () => {
    if (this.disposed || this.initialized) return;
    this.initialized = true;
    const id = deviceLayerIds;
    this.map.addSource(id.source, { type: "geojson", data: deviceSymbolFeatures(this.points, this.selected), cluster: true, clusterRadius: 46, clusterMaxZoom: 13 });
    this.map.addLayer({ id: id.cluster, type: "circle", source: id.source, filter: ["has", "point_count"], paint: { "circle-radius": ["step", ["get", "point_count"], 20, 10, 24, 100, 29], "circle-color": "#123c50", "circle-stroke-width": 3, "circle-stroke-color": "#5fd6c0" } });
    this.map.on("styleimagemissing", this.clusterImage);
    this.map.addLayer({ id: id.count, type: "symbol", source: id.source, filter: ["has", "point_count"], layout: { "icon-image": ["concat", "eco-count-", ["to-string", ["get", "point_count_abbreviated"]]], "icon-allow-overlap": true } });
    this.map.addLayer({ id: id.halo, type: "circle", source: id.source, filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "selected"], true]], paint: { "circle-radius": 10, "circle-color": "#51dfff", "circle-opacity": .16, "circle-stroke-color": "#8eefff", "circle-stroke-width": 1.5 } });
    this.map.addLayer({ id: id.symbol, type: "symbol", source: id.source, filter: ["!", ["has", "point_count"]], layout: { "icon-image": ["get", "icon"], "icon-size": .7, "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport", "symbol-sort-key": ["case", ["get", "selected"], 1, 0] } });
    this.map.on("click", id.symbol, this.select);
    this.map.on("click", id.cluster, this.expand);
    this.map.on("mouseenter", id.symbol, this.pointer); this.map.on("mouseleave", id.symbol, this.unpointer);
    this.map.on("mouseenter", id.cluster, this.pointer); this.map.on("mouseleave", id.cluster, this.unpointer);
    this.render();
  };
  private render() {
    if (this.disposed) return;
    for (const p of this.points) {
      const selected = p.device_id === this.selected;
      const key = deviceSymbolId(p.device_type, p.status, selected);
      if (this.map.hasImage(key) || this.pending.has(key)) continue;
      this.pending.add(key);
      void rasterizeDeviceSymbol(deviceSymbolSvg(deviceKind(p.device_type), symbolState(p.status), selected)).then(image => {
        if (!this.disposed && !this.map.hasImage(key)) this.map.addImage(key, image, { pixelRatio: 2 });
      }).catch(() => { if (!this.disposed) this.onError?.("设备图标加载失败，请刷新重试"); }).finally(() => this.pending.delete(key));
    }
    (this.map.getSource(deviceLayerIds.source) as GeoJSONSource).setData(deviceSymbolFeatures(this.points, this.selected));
  }
  private select = (event: MapLayerMouseEvent) => { const id = event.features?.[0]?.properties?.device_id; if (typeof id === "string") this.onSelect(id); };
  private expand = async (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]; if (!feature || feature.geometry.type !== "Point") return;
    try {
      const zoom = await (this.map.getSource(deviceLayerIds.source) as GeoJSONSource).getClusterExpansionZoom(Number(feature.properties?.cluster_id));
      if (!this.disposed) this.map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
    } catch { if (!this.disposed) this.onError?.("设备聚合读取失败，请重试"); }
  };
  private pointer = (event: MapLayerMouseEvent) => {
    this.map.getCanvas().style.cursor = "pointer";
    const feature = event.features?.[0];
    if (feature?.geometry.type === "Point" && typeof feature.properties?.name === "string") {
      this.popup?.remove();
      this.popup = new Popup({ className: "device-map-hover-popup", closeButton: false, closeOnClick: false, offset: 42, maxWidth: "280px" }).setLngLat(feature.geometry.coordinates as [number, number]).setText(feature.properties.name).addTo(this.map);
    }
  };
  private clusterImage = (event: { id: string }) => {
    if (!event.id.startsWith("eco-count-") || this.map.hasImage(event.id)) return;
    const text = event.id.slice(10).slice(0, 6);
    const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 60;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#f0ffff"; ctx.font = "bold 26px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 50, 30);
    this.map.addImage(event.id, ctx.getImageData(0, 0, 100, 60), { pixelRatio: 2 });
  };
  private unpointer = () => { this.map.getCanvas().style.cursor = ""; this.popup?.remove(); };
  dispose() {
    this.disposed = true; this.map.off("load", this.initialize);
    this.map.off("styledata", this.initialize);
    this.popup?.remove();
    if (!this.initialized) return;
    const id = deviceLayerIds;
    this.map.off("styleimagemissing", this.clusterImage);
    this.map.off("click", id.symbol, this.select); this.map.off("click", id.cluster, this.expand);
    this.map.off("mouseenter", id.symbol, this.pointer); this.map.off("mouseleave", id.symbol, this.unpointer);
    this.map.off("mouseenter", id.cluster, this.pointer); this.map.off("mouseleave", id.cluster, this.unpointer);
    for (const layer of [id.symbol, id.halo, id.count, id.cluster]) if (this.map.getLayer(layer)) this.map.removeLayer(layer);
    if (this.map.getSource(id.source)) this.map.removeSource(id.source);
  }
}
