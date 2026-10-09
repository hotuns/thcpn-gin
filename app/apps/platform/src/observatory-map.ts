import type { Map, StyleSpecification } from "maplibre-gl";

// Optional elevation never gates the basemap or device data.
export const terrainSource = {
  type: "raster-dem" as const,
  tiles: [
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  ],
  tileSize: 256,
  maxzoom: 15,
  encoding: "terrarium" as const,
  attribution:
    '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener noreferrer">Terrain: Mapzen / AWS Open Data</a>',
};
export function setSceneTerrain(map: Map, enabled: boolean) {
  if (enabled && !map.getSource("observatory-dem"))
    map.addSource("observatory-dem", terrainSource);
  map.setTerrain(
    enabled ? { source: "observatory-dem", exaggeration: 1.25 } : null,
  );
  map.setSky({
    "sky-color": "#071523",
    "horizon-color": "#244553",
    "fog-color": "#162a3b",
    "sky-horizon-blend": 0.7,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.7,
  });
}
export function motionDuration() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 700;
}
export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tileSize: 256,
        maxzoom: 18,
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        attribution:
          "Tiles © Esri — Esri, Maxar, Earthstar Geographics, GIS User Community",
      },
    },
    layers: [
      {
        id: "satellite",
        type: "raster",
        source: "satellite",
        paint: {
          "raster-saturation": -0.18,
          "raster-brightness-max": 0.82,
          "raster-contrast": 0.08,
        },
      },
    ],
  };
}
