import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import Supercluster from "supercluster";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

export type DeviceMapPoint = { device_id: string; name: string; device_type: string; status: string; latitude?: number; longitude?: number; child_count?: number; ecosystem?: string; purposes?: string[] };

function defaultStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}

export function DeviceMap({ points, onSelect, height = 520, styleUrl }: { points: DeviceMapPoint[]; onSelect?: (id: string) => void; height?: number; styleUrl?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const latestPoints = useRef(points);
  latestPoints.current = points;
  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new maplibregl.Map({ container: container.current, style: styleUrl || defaultStyle(), center: [104, 35], zoom: 3, attributionControl: {} });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    fit(instance, latestPoints.current);
    return () => { markers.current.forEach((marker) => marker.remove()); markers.current = []; instance.remove(); map.current = null; };
  }, [styleUrl]);
  useEffect(() => {
    let attempts = 0;
    let retry: ReturnType<typeof setInterval> | undefined;
    let renderMarkers: (() => void) | undefined;
    const applyPoints = () => {
      const instance = map.current;
      if (!instance) return false;
      const index = new Supercluster<DeviceMarkerProperties, Supercluster.AnyProps>({ radius: 46, maxZoom: 13 });
      index.load(deviceFeatureCollection(points).features);
      renderMarkers = () => {
        markers.current.forEach((marker) => marker.remove());
        const bounds = instance.getBounds();
        const clusters = index.getClusters([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], Math.round(instance.getZoom()));
        markers.current = clusters.map((feature) => {
          const element = document.createElement("button");
          element.type = "button";
          const properties = feature.properties;
          if ("cluster" in properties && properties.cluster) {
            element.className = "device-map-marker device-map-cluster";
            element.textContent = String(properties.point_count_abbreviated);
            element.title = `${properties.point_count} 台设备`;
            element.addEventListener("click", () => instance.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: index.getClusterExpansionZoom(properties.cluster_id) }));
          } else {
            element.className = `device-map-marker device-map-point ${properties.status === "active" ? "is-active" : ""}`;
            element.title = properties.name;
            element.addEventListener("click", () => onSelect?.(properties.device_id));
          }
          element.setAttribute("aria-label", element.title);
          return new maplibregl.Marker({ element }).setLngLat(feature.geometry.coordinates as [number, number]).addTo(instance);
        });
      };
      instance.on("moveend", renderMarkers);
      renderMarkers();
      fit(instance, points);
      return true;
    };
    if (!applyPoints()) {
      retry = setInterval(() => {
        attempts++;
        if (applyPoints() || attempts >= 200) {
          if (retry !== undefined) clearInterval(retry);
        }
      }, 50);
    }
    return () => {
      if (retry !== undefined) clearInterval(retry);
      if (renderMarkers && map.current) map.current.off("moveend", renderMarkers);
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
    };
  }, [points]);
  return <div ref={container} className="device-map-canvas" style={{ height }} />;
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

type DeviceMarkerProperties = {
  device_id: string;
  name: string;
  device_type: string;
  status: string;
  child_count: number;
  ecosystem: string;
  purposes: string;
};

function deviceFeatureCollection(points: DeviceMapPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: locatedPoints(points).map((point) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [point.longitude!, point.latitude!] },
      properties: {
        device_id: point.device_id,
        name: point.name,
        device_type: point.device_type,
        status: point.status,
        child_count: point.child_count ?? 0,
        ecosystem: point.ecosystem ?? "",
        purposes: (point.purposes ?? []).join("、"),
      },
    })),
  };
}

function locatedPoints(points: DeviceMapPoint[]) {
  return points.filter((point) =>
    typeof point.latitude === "number"
    && Number.isFinite(point.latitude)
    && typeof point.longitude === "number"
    && Number.isFinite(point.longitude));
}

function fit(map: MapLibreMap, points: DeviceMapPoint[]) { const located = locatedPoints(points); if (!located.length) return; const bounds = new maplibregl.LngLatBounds(); located.forEach((p) => bounds.extend([p.longitude!, p.latitude!])); if (located.length === 1) map.easeTo({ center: bounds.getCenter(), zoom: 12 }); else map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 0 }); }
