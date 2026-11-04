import { useEffect, useRef, useState } from "react";
import { Map, LngLatBounds, ScaleControl } from "maplibre-gl";
import { NativeDeviceLayer, tiandituImageryStyle } from "@thcpn/device-map";
import { api, formatApiError, type DeviceMapItem } from "@thcpn/api";
import { useQuery } from "@tanstack/react-query";
import { workspaceQueryKey } from "@thcpn/workspace";
import { AtlasNetwork } from "./atlas-network";
import { networkMarkerIds, networkNodes } from "./atlas-network-model";
import { useLocale } from "@thcpn/i18n";
import { Crosshair, Globe2, Mountain, Map as MapIcon } from "lucide-react";
import { Button } from "../../shared/ui";
import { located } from "./atlas-model";
import { MapTools } from "../../shared/maps/map-tools";
import { useIsMobile } from "../../shared/hooks/use-mobile";
import {
  motionDuration,
  satelliteStyle,
  setSceneTerrain,
} from "../../shared/observatory/observatory-map";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = {
  points: DeviceMapItem[];
  networkDevices?: DeviceMapItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  reset: number;
  onReset: () => void;
  panorama?: boolean;
  workspaceId?: string;
  selectedNodeKey?: string;
  onSelectNode?: (key: string) => void;
  motionEnabled?: boolean;
  appearance?: "deep-blue" | "research" | "expedition";
};

export function AtlasMapActions({ ready, terrain, terrainError, onReset, onTerrain, globe = false, onGlobe }: {
  ready: boolean; terrain: boolean; terrainError: boolean;
  onReset: () => void; onTerrain: () => void;
  globe?: boolean; onGlobe?: () => void;
}) {
  const { t } = useLocale();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  return <>{mobile && <Button className="atlas-mobile-view-toggle" variant="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>视图</Button>}<div className="observatory-view-controls atlas-map-actions" hidden={mobile && !open} role="group" aria-label={t("atlas.overview")}>
    <Button variant="ghost" onClick={onReset}>
      <Crosshair size={15} />{t("atlas.resetMap")}
    </Button>
    <Button variant="ghost" aria-pressed={terrain && !globe} disabled={!ready || terrainError || globe} onClick={onTerrain} title={t("atlas.terrainHint")}>
      {terrain ? <Mountain size={14} /> : <MapIcon size={14} />}
      {t(terrain ? "atlas.terrain3d" : "atlas.terrain2d")}
    </Button>
    {onGlobe && <Button variant="ghost" aria-pressed={globe} disabled={!ready} onClick={onGlobe} title={t("atlas.globeHint")}><Globe2 size={15} />{t(globe ? "atlas.returnMap" : "atlas.globe")}</Button>}
    {terrainError && !globe && <small role="status">{t("atlas.terrainUnavailable")}</small>}
  </div></>;
}
export function AtlasMap(props: Props) {
  const { t } = useLocale();
  const independentAppearance = props.appearance !== undefined;
  const mapPrefix = props.appearance === "deep-blue" ? "eco" : props.appearance;
  const selectedGateway = props.points.find(point => point.device_id === props.selectedId && point.device_type === "gateway");
  const nodes = useQuery({
    queryKey: workspaceQueryKey(props.workspaceId ?? "", "atlas", selectedGateway?.device_id ?? "", "nodes"),
    queryFn: () => api.devices.nodes(selectedGateway!.device_id),
    enabled: Boolean(props.workspaceId && selectedGateway),
    staleTime: 60000,
  });
  const gatewayNodes = nodes.data?.items ?? [];
  const networkLocations = networkNodes(gatewayNodes, props.networkDevices ?? props.points);
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Map | null>(null);
  const current = useRef(props);
  current.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [terrain, setTerrain] = useState(props.appearance !== "research");
  const [globe, setGlobe] = useState(false);
  const globeRef = useRef(false);
  globeRef.current = globe;
  const savedCamera = useRef<{ center: [number, number]; zoom: number; bearing: number } | null>(null);
  const [terrainError, setTerrainError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const deviceLayer = useRef<NativeDeviceLayer | null>(null);
  const padding = (map: Map) => {
    const width = map.getContainer().clientWidth;
    if (current.current.appearance === "deep-blue" && width > 900) return {
      top: 150,
      bottom: 110,
      left: Math.round(width * .25) + 35,
      right: Math.round(width * .28) + 35,
    };
    if (current.current.appearance === "research") return { top: 40, bottom: 40, left: 40, right: 40 };
    if (current.current.appearance === "expedition") {
      const height = map.getContainer().clientHeight;
      const top = Math.min(170, Math.max(30, height - 180));
      return { top, left: Math.min(285, width * .35), right: 60,
        bottom: Math.max(0, Math.min(Math.max(414, Math.min(500, height * .4)) + 45, height - top - 100)) };
    }
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
    if (!map || !ready || !["research", "expedition"].includes(props.appearance ?? "")) return;
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.type !== "raster" || layer.id.includes("labels")) continue;
      const research = props.appearance === "research";
      map.setPaintProperty(layer.id, "raster-saturation", research ? -0.7 : -0.65);
      map.setPaintProperty(layer.id, "raster-brightness-min", research ? 0.2 : 0.04);
      map.setPaintProperty(layer.id, "raster-brightness-max", research ? 1 : 0.65);
      map.setPaintProperty(layer.id, "raster-contrast", research ? -0.12 : 0.12);
    }
  }, [ready, props.appearance]);
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
    const childIds = networkMarkerIds(globe ? [] : networkLocations.locatedNodes, props.points);
    const overlayGateway = !globe && selectedGateway && located(selectedGateway) && Boolean(nodes.data);
    deviceLayer.current.update(props.points.filter(point => !childIds.has(point.device_id) && !(overlayGateway && point.device_id === selectedGateway.device_id)), props.selectedId);
  }, [ready, props.points, props.selectedId, nodes.data, globe, props.networkDevices]);
  useEffect(() => {
    const map = instance.current;
    const selected = props.points.find(
      (p) => p.device_id === props.selectedId && located(p),
    );
    if (!map || !ready || !selected) return;
    if (selectedGateway && networkLocations.locatedNodes.length) {
      const bounds = new LngLatBounds([selected.longitude!, selected.latitude!], [selected.longitude!, selected.latitude!]);
      networkLocations.locatedNodes.forEach(({ location }) => bounds.extend([location.longitude, location.latitude]));
      map.fitBounds(bounds, { padding: padding(map), maxZoom: 17, pitch: terrain && !globeRef.current ? (props.panorama ? 48 : 30) : 0, duration: motionDuration() });
      return;
    }
    map.easeTo({
      center: [selected.longitude!, selected.latitude!],
      padding: padding(map),
      pitch: terrain && !globeRef.current ? (props.panorama ? 48 : 30) : 0,
      duration: motionDuration(),
    });
  }, [ready, props.selectedId, locations, nodes.data, props.networkDevices, terrain]);
  return (
    <div className={`${independentAppearance ? `${mapPrefix}-map` : "observatory-map"}${globe ? " is-globe" : ""}`}>
      <div
        ref={host}
        className={independentAppearance ? `${mapPrefix}-map-canvas` : "observatory-map-canvas"}
        aria-label={t("atlas.overview")}
      />
      {ready && !globe && selectedGateway && nodes.data && instance.current && <AtlasNetwork
        map={instance.current} gateway={selectedGateway} nodes={gatewayNodes} devices={props.networkDevices ?? props.points}
        selectedNodeKey={props.selectedNodeKey} running={props.motionEnabled !== false} appearance={props.appearance}
        onSelectNode={key => {
          if (props.onSelectNode) props.onSelectNode(key);
          else {
            const node = gatewayNodes.find(item => item.key === key);
            if (node?.target.kind === "device") props.onSelect(node.target.device_id);
          }
        }}
      />}
      {selectedGateway && nodes.error && <div className={independentAppearance ? `${mapPrefix}-network-status` : "atlas-network-caption"} role="alert">{formatApiError(nodes.error).message}<Button onClick={() => void nodes.refetch()}>重试组网信息</Button></div>}
      {independentAppearance ? <div className={`${mapPrefix}-map-controls`} role="group" aria-label={t("atlas.overview")}>
        <button type="button" title={t("atlas.resetMap")} aria-label={t("atlas.resetMap")} onClick={props.onReset}><Crosshair size={17} /></button>
        <button type="button" title={t("atlas.terrainHint")} aria-label={t(terrain ? "atlas.terrain3d" : "atlas.terrain2d")} aria-pressed={terrain && !globe} disabled={!ready || terrainError || globe} onClick={() => setTerrain(value => !value)}>{terrain ? <Mountain size={17} /> : <MapIcon size={17} />}</button>
        <button type="button" title={t("atlas.globeHint")} aria-label={t(globe ? "atlas.returnMap" : "atlas.globe")} aria-pressed={globe} disabled={!ready} onClick={() => setGlobe(value => !value)}><Globe2 size={17} /></button>
        {terrainError && !globe && <small role="status">{t("atlas.terrainUnavailable")}</small>}
      </div> : <>
        <AtlasMapActions ready={ready} terrain={terrain} terrainError={terrainError} globe={globe} onGlobe={() => setGlobe(value => !value)} onReset={props.onReset} onTerrain={() => setTerrain(value => !value)} />
        <MapTools map={ready ? instance.current : null} />
      </>}
      {(!ready || failed) && (
        <div
          className={independentAppearance ? `${mapPrefix}-map-status` : "observatory-map-status"}
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
