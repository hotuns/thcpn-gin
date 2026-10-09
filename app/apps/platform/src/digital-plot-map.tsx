import { useEffect, useRef, useState } from "react";
import {
  Map,
  Marker,
  ScaleControl,
  type ImageSource,
  type StyleSpecification,
} from "maplibre-gl";
import { useLocale } from "@thcpn/i18n";
import {
  aerialTiles,
  containsPoint,
  imageBounds,
  orthophoto,
  plots,
  type Flight,
  type PlotMetric,
} from "./digital-plot-model";
import { Button } from "./platform-ui";
import { Mountain, Map as MapIcon } from "lucide-react";
import { motionDuration, setSceneTerrain } from "./observatory-map";
import {
  boundaryTexture,
  demoStations,
  fieldCorners,
  fieldTexture,
} from "./digital-plot-field";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = {
  selected: string;
  frame: number;
  metric: PlotMetric;
  heatmap: boolean;
  boundaries: boolean;
  stations: boolean;
  heat: boolean;
  aerial: boolean;
  opacity: number;
  flight?: Flight;
  reset: number;
  onSelect: (id: string) => void;
};
function fitParcels(
  map: Map,
  pitch = map.getPitch(),
  bearing = map.getBearing(),
) {
  const width = map.getContainer().clientWidth;
  const wide = window.innerWidth > 1000;
  const padding = wide
    ? {
        top: 130,
        bottom: 80,
        left: width > 1060 ? 285 : 250,
        right: width > 1060 ? 375 : 340,
      }
    : { top: 130, bottom: 85, left: 30, right: 30 };
  map.fitBounds(
    [
      [24.984, 53.8718],
      [25.016, 53.8868],
    ],
    { padding, pitch, bearing, duration: 0 },
  );
}
export function DigitalPlotMap(props: Props) {
  const { t } = useLocale();
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Map | null>(null);
  const labels = useRef<Marker[]>([]);
  const stations = useRef<Marker[]>([]);
  const current = useRef(props);
  current.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fieldError, setFieldError] = useState(false);
  const [terrain, setTerrain] = useState(true);
  const [terrainError, setTerrainError] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    setReady(false);
    setFailed(false);
    setTileError(false);
    setFieldError(false);
    setTerrainError(false);
    let map: Map;
    // This public demo is georeferenced to the OAM sample in Belarus, not a
    // Chinese customer site. Use a worldwide imagery service at this location.
    const base: StyleSpecification = {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          maxzoom: 18,
          attribution:
            "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        },
      },
      layers: [
        {
          id: "satellite",
          type: "raster",
          source: "satellite",
          paint: { "raster-saturation": -0.3, "raster-brightness-max": 0.72 },
        },
      ],
    };
    try {
      map = new Map({
        container: host.current,
        style: base,
        center: [24.999, 53.879],
        zoom: 15.6,
        maxZoom: 19,
        minZoom: 12,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 60,
      });
    } catch {
      setFailed(true);
      return;
    }
    instance.current = map;
    const timer = window.setTimeout(() => setFailed(true), 20000);
    map.on("error", (e) => {
      if ("sourceId" in e && e.sourceId === "ortho-tiles") setTileError(true);
      if ("sourceId" in e && e.sourceId === "observatory-dem") {
        setTerrainError(true);
        setTerrain(false);
      }
    });
    map.on("load", () => {
      window.clearTimeout(timer);
      setFailed(false);
      map.addSource("ortho-preview", {
        type: "image",
        url: orthophoto,
        coordinates: [
          [imageBounds[0], imageBounds[3]],
          [imageBounds[2], imageBounds[3]],
          [imageBounds[2], imageBounds[1]],
          [imageBounds[0], imageBounds[1]],
        ],
      });
      map.addSource("ortho-tiles", {
        type: "raster",
        tiles: [aerialTiles],
        tileSize: 256,
        maxzoom: 20,
        bounds: [...imageBounds],
        attribution:
          'BSU / <a href="https://openaerialmap.org/about/" target="_blank" rel="noopener noreferrer">Open Imagery Network</a> · CC BY 4.0',
      });
      map.addLayer({
        id: "ortho-preview",
        type: "raster",
        source: "ortho-preview",
        paint: { "raster-brightness-max": 0.8 },
      });
      map.addLayer({
        id: "ortho",
        type: "raster",
        source: "ortho-tiles",
        paint: { "raster-brightness-max": 0.8 },
      });
      try {
        const state = current.current;
        map.addSource("demo-field", {
          type: "image",
          url: fieldTexture(state.frame, state.metric, state.heatmap),
          coordinates: fieldCorners,
        });
        map.addLayer({
          id: "demo-field",
          type: "raster",
          source: "demo-field",
          paint: {
            "raster-opacity": state.opacity / 100,
            "raster-fade-duration": 0,
          },
        });
        map.addSource("parcel-boundaries", {
          type: "image",
          url: boundaryTexture(state.selected, state.boundaries),
          coordinates: fieldCorners,
        });
        map.addLayer({
          id: "parcel-boundaries",
          type: "raster",
          source: "parcel-boundaries",
          paint: { "raster-fade-duration": 0 },
        });
      } catch {
        setFieldError(true);
      }
      map.on("click", (e) => {
        const plot = plots.find((p) =>
          containsPoint(p, e.lngLat.lng, e.lngLat.lat),
        );
        if (plot) current.current.onSelect(plot.id);
      });
      map.on("mousemove", (e) => {
        map.getCanvas().style.cursor = plots.some((p) =>
          containsPoint(p, e.lngLat.lng, e.lngLat.lat),
        )
          ? "pointer"
          : "";
      });
      labels.current = plots.map((plot) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "dp-map-label";
        el.textContent = plot.id;
        el.setAttribute("aria-label", plot.id);
        el.onclick = () => current.current.onSelect(plot.id);
        return new Marker({ element: el }).setLngLat(plot.center).addTo(map);
      });
      stations.current = demoStations.map((station) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "dp-station-marker";
        const mast = document.createElement("i");
        mast.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = station.id;
        el.append(mast, label);
        el.setAttribute(
          "aria-label",
          `${t("digitalPlot.station")} ${station.id} · ${station.plot.id}`,
        );
        el.onclick = () => current.current.onSelect(station.plot.id);
        return new Marker({ element: el, anchor: "bottom" })
          .setLngLat(station.coordinate)
          .addTo(map);
      });
      map.addControl(
        new ScaleControl({ maxWidth: 90, unit: "metric" }),
        "bottom-left",
      );
      setReady(true);
    });
    const observer = new ResizeObserver(() => {
      map.resize();
      if (map.getLayer("ortho")) fitParcels(map);
    });
    observer.observe(host.current);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      labels.current.forEach((marker) => marker.remove());
      labels.current = [];
      stations.current.forEach((marker) => marker.remove());
      stations.current = [];
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
      setTerrainError(true);
      setTerrain(false);
    }
    map.easeTo({
      pitch: terrain ? 45 : 0,
      bearing: terrain ? -14 : 0,
      duration: motionDuration(),
    });
  }, [ready, terrain]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !ready) return;
    const showAerial = props.aerial && props.flight;
    for (const id of ["ortho", "ortho-preview"]) {
      map.setLayoutProperty(id, "visibility", showAerial ? "visible" : "none");
      map.setPaintProperty(
        id,
        "raster-saturation",
        props.aerial && props.flight ? props.flight.saturation : -0.35,
      );
      map.setPaintProperty(
        id,
        "raster-brightness-max",
        props.aerial && props.flight ? props.flight.brightness : 0.72,
      );
    }
    labels.current.forEach((marker, i) => {
      const el = marker.getElement();
      el.classList.toggle("is-selected", plots[i].id === props.selected);
    });
    stations.current.forEach((marker, i) => {
      marker.getElement().hidden = !props.stations;
      marker
        .getElement()
        .classList.toggle(
          "is-selected",
          demoStations[i].plot.id === props.selected,
        );
    });
    if (map.getLayer("demo-field")) {
      map.setLayoutProperty(
        "demo-field",
        "visibility",
        props.heat ? "visible" : "none",
      );
      map.setPaintProperty("demo-field", "raster-opacity", props.opacity / 100);
    }
  }, [ready, props]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !ready || !map.getSource("parcel-boundaries")) return;
    (map.getSource("parcel-boundaries") as ImageSource).updateImage({
      url: boundaryTexture(props.selected, props.boundaries),
    });
  }, [ready, props.selected, props.boundaries]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !ready || !map.getSource("demo-field")) return;
    try {
      (map.getSource("demo-field") as ImageSource).updateImage({
        url: fieldTexture(props.frame, props.metric, props.heatmap),
      });
      setFieldError(false);
    } catch {
      setFieldError(true);
    }
  }, [ready, props.frame, props.metric, props.heatmap]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !ready) return;
    fitParcels(map, terrain ? 45 : 0, terrain ? -14 : 0);
  }, [ready, props.reset]);
  return (
    <div className="dp-map-container">
      <div className="observatory-view-controls">
        <Button
          variant="ghost"
          disabled={!ready || terrainError}
          aria-pressed={terrain}
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
      <div
        ref={host}
        className="dp-map-canvas"
        aria-label={t("digitalPlot.directory")}
      />
      {fieldError && (
        <div className="dp-map-warning" role="status">
          {t("digitalPlot.fieldUnavailable")}
        </div>
      )}
      {!ready && !failed && (
        <div className="dp-map-message" role="status">
          {t("digitalPlot.loading")}
        </div>
      )}
      {failed && (
        <div className="dp-map-message" role="alert">
          {t("digitalPlot.mapError")}
          <Button onClick={() => setAttempt((n) => n + 1)}>
            {t("digitalPlot.retry")}
          </Button>
        </div>
      )}
      {tileError && (
        <small className="dp-map-warning">
          {t("digitalPlot.aerialUnavailable")}
        </small>
      )}
    </div>
  );
}
