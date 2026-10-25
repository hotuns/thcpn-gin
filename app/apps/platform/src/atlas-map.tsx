import { useEffect, useRef, useState } from "react";
import { Map, LngLatBounds, ScaleControl } from "maplibre-gl";
import { NativeDeviceLayer, tiandituImageryStyle } from "@thcpn/device-map";
import type { DeviceMapItem } from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";
import { Crosshair, Globe2, Mountain, Map as MapIcon } from "lucide-react";
import { Button } from "./platform-ui";
import { located } from "./atlas-model";
import { MapTools } from "./map-tools";
import {
  motionDuration,
  satelliteStyle,
  setSceneTerrain,
} from "./observatory-map";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = {
  points: DeviceMapItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  reset: number;
  onReset: () => void;
  panorama?: boolean;
};

export function AtlasMapActions({ ready, terrain, terrainError, onReset, onTerrain, globe = false, onGlobe }: {
  ready: boolean; terrain: boolean; terrainError: boolean;
  onReset: () => void; onTerrain: () => void;
  globe?: boolean; onGlobe?: () => void;
}) {
  const { t } = useLocale();
  return <div className="observatory-view-controls atlas-map-actions" role="group" aria-label={t("atlas.overview")}>
    <Button variant="ghost" onClick={onReset}>
      <Crosshair size={15} />{t("atlas.resetMap")}
    </Button>
    <Button variant="ghost" aria-pressed={terrain && !globe} disabled={!ready || terrainError || globe} onClick={onTerrain} title={t("atlas.terrainHint")}>
      {terrain ? <Mountain size={14} /> : <MapIcon size={14} />}
      {t(terrain ? "atlas.terrain3d" : "atlas.terrain2d")}
    </Button>
    {onGlobe && <Button variant="ghost" aria-pressed={globe} disabled={!ready} onClick={onGlobe} title={t("atlas.globeHint")}><Globe2 size={15} />{t(globe ? "atlas.returnMap" : "atlas.globe")}</Button>}
    {terrainError && !globe && <small role="status">{t("atlas.terrainUnavailable")}</small>}
  </div>;
}
export function AtlasMap(props: Props) {
  const { t } = useLocale();
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Map | null>(null);
  const current = useRef(props);
  current.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [terrain, setTerrain] = useState(true);
  const [globe, setGlobe] = useState(false);
  const globeRef = useRef(false);
  globeRef.current = globe;
  const savedCamera = useRef<{ center: [number, number]; zoom: number; bearing: number } | null>(null);
  const [terrainError, setTerrainError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const deviceLayer = useRef<NativeDeviceLayer | null>(null);
  const padding = (map: Map) => {
    const width = map.getContainer().clientWidth;
    return current.current.panorama && width > 900
      ? {
          top: 120,
          bottom: 65,
          left: Math.min(280, width * 0.23),
          right: Math.min(480, width * 0.36),
        }
      : { top: 65, bottom: 55, left: 55, right: 55 };
  };
  const fit = (map: Map) => {
    if (globeRef.current) {
      map.easeTo({ zoom: 1.1, pitch: 0, bearing: 0, padding: padding(map), duration: motionDuration() });
      return;
    }
    const points = current.current.points.filter(located);
    if (!points.length) return;
    const bounds = new LngLatBounds();
    points.forEach((p) => bounds.extend([p.longitude!, p.latitude!]));
    map.fitBounds(bounds, {
      padding: padding(map),
      maxZoom: 14,
      pitch: terrain ? (current.current.panorama ? 48 : 30) : 0,
      duration: motionDuration(),
    });
  };
  useEffect(() => {
    if (!host.current) return;
    setReady(false);
    setFailed(false);
    setTerrainError(false);
    const token = import.meta.env.VITE_TIANDITU_TOKEN?.trim();
    const style = token
      ? tiandituImageryStyle(token)
      : import.meta.env.VITE_MAP_STYLE_URL || satelliteStyle();
    let map: Map;
    try {
      map = new Map({
        container: host.current,
        style,
        center: [104, 35],
        zoom: 3,
        maxPitch: 65,
        canvasContextAttributes: { preserveDrawingBuffer: true },
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    instance.current = map;
    const timer = window.setTimeout(() => setFailed(true), 20000);
    map.on("load", () => {
      clearTimeout(timer);
      setReady(true);
      setFailed(false);
      if (map.getLayer("tianditu-imagery")) {
        map.setPaintProperty("tianditu-imagery", "raster-saturation", -0.18);
        map.setPaintProperty("tianditu-imagery", "raster-brightness-max", 0.85);
      }
      map.addControl(new ScaleControl({ maxWidth: 100 }), "bottom-left");
    });
    map.on("error", (e) => {
      if ("sourceId" in e && e.sourceId === "observatory-dem") {
        setTerrainError(true);
        setTerrain(false);
      }
    });
    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(host.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      deviceLayer.current?.dispose();
      deviceLayer.current = null;
      map.remove();
      instance.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !ready) return;
    try {
      setSceneTerrain(map, terrain && !globe);
    } catch {
      setTerrain(false);
      setTerrainError(true);
    }
    map.easeTo({
      pitch: terrain && !globe ? (props.panorama ? 48 : 30) : 0,
      duration: motionDuration(),
    });
  }, [ready, terrain, globe, props.panorama]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !ready) return;
    if (globe) {
      const center = map.getCenter();
      savedCamera.current = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing() };
      map.setProjection({ type: "globe" });
      map.easeTo({ center: [center.lng, Math.max(-55, Math.min(55, center.lat))], zoom: 1.1, pitch: 0, bearing: 0, padding: padding(map), duration: motionDuration() });
    } else {
      map.setProjection({ type: "mercator" });
      if (savedCamera.current) {
        map.easeTo({ ...savedCamera.current, pitch: terrain ? (props.panorama ? 48 : 30) : 0, duration: motionDuration() });
        savedCamera.current = null;
      }
    }
  }, [ready, globe]);
  const locations = JSON.stringify(
    props.points
      .filter(located)
      .map((p) => [p.device_id, p.longitude, p.latitude]),
  );
  useEffect(() => {
    const map = instance.current;
    if (map && ready) fit(map);
  }, [ready, props.reset, locations]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !ready) return;
    if (!deviceLayer.current) deviceLayer.current = new NativeDeviceLayer(map, id => current.current.onSelect(id));
    deviceLayer.current.update(props.points, props.selectedId);
  }, [ready, props.points, props.selectedId]);
  useEffect(() => {
    const map = instance.current;
    const selected = props.points.find(
      (p) => p.device_id === props.selectedId && located(p),
    );
    if (!map || !ready || !selected) return;
    map.easeTo({
      center: [selected.longitude!, selected.latitude!],
      padding: padding(map),
      pitch: terrain && !globeRef.current ? (props.panorama ? 48 : 30) : 0,
      duration: motionDuration(),
    });
  }, [ready, props.selectedId, locations]);
  return (
    <div className={`observatory-map${globe ? " is-globe" : ""}`}>
      <div
        ref={host}
        className="observatory-map-canvas"
        aria-label={t("atlas.overview")}
      />
      <AtlasMapActions ready={ready} terrain={terrain} terrainError={terrainError} globe={globe} onGlobe={() => setGlobe(value => !value)} onReset={props.onReset} onTerrain={() => setTerrain(value => !value)} />
      <MapTools map={ready ? instance.current : null} />
      {(!ready || failed) && (
        <div
          className="observatory-map-status"
          role={failed ? "alert" : "status"}
        >
          {t(failed ? "atlas.mapUnavailable" : "atlas.loading")}
          {failed && (
            <Button onClick={() => setAttempt((n) => n + 1)}>
              {t("atlas.retry")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
