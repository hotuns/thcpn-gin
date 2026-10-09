import { useEffect, useRef, useState } from "react";
import { Map, Marker, LngLatBounds, ScaleControl } from "maplibre-gl";
import { tiandituImageryStyle } from "@thcpn/device-map";
import type { DeviceMapItem } from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";
import { Mountain, Map as MapIcon } from "lucide-react";
import { Button } from "./platform-ui";
import { located } from "./atlas-model";
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
  panorama?: boolean;
};
export function AtlasMap(props: Props) {
  const { t } = useLocale();
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Map | null>(null);
  const current = useRef(props);
  current.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [terrain, setTerrain] = useState(true);
  const [terrainError, setTerrainError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const markers = useRef<Marker[]>([]);
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
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.remove();
      instance.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !ready) return;
    try {
      setSceneTerrain(map, terrain);
    } catch {
      setTerrain(false);
      setTerrainError(true);
    }
    map.easeTo({
      pitch: terrain ? (props.panorama ? 48 : 30) : 0,
      duration: motionDuration(),
    });
  }, [ready, terrain, props.panorama]);
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
    markers.current.forEach((m) => m.remove());
    markers.current = props.points.filter(located).map((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className =
        "observatory-marker" +
        (p.device_id === props.selectedId ? " is-selected" : "");
      el.setAttribute("aria-label", p.name);
      el.setAttribute("aria-pressed", String(p.device_id === props.selectedId));
      const pin = document.createElement("span");
      pin.className = "observatory-pin";
      pin.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "observatory-marker-name";
      label.textContent = p.name;
      el.append(pin, label);
      el.onclick = () => current.current.onSelect(p.device_id);
      return new Marker({ element: el, anchor: "bottom" })
        .setLngLat([p.longitude!, p.latitude!])
        .addTo(map);
    });
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
      pitch: terrain ? (props.panorama ? 48 : 30) : 0,
      duration: motionDuration(),
    });
  }, [ready, props.selectedId, locations]);
  return (
    <div className="observatory-map">
      <div
        ref={host}
        className="observatory-map-canvas"
        aria-label={t("atlas.overview")}
      />
      <div className="observatory-view-controls">
        <Button
          variant="ghost"
          aria-pressed={terrain}
          disabled={!ready || terrainError}
          onClick={() => setTerrain(!terrain)}
          title={t("atlas.terrainHint")}
        >
          {terrain ? <Mountain size={14} /> : <MapIcon size={14} />}
          {t(terrain ? "atlas.terrain3d" : "atlas.terrain2d")}
        </Button>
        {terrainError && (
          <small role="status">{t("atlas.terrainUnavailable")}</small>
        )}
      </div>
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
