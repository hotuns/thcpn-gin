import type { Map } from "maplibre-gl";
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

export function createMapDraw(map: Map) {
  const draw = new TerraDraw({ adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }), modes: [
    new TerraDrawPolygonMode(), new TerraDrawLineStringMode(),
    new TerraDrawSelectMode({ flags: { polygon: { feature: { draggable: true, coordinates: { draggable: true, midpoints: true, deletable: true }, selfIntersectable: false } }, linestring: { feature: { draggable: true, coordinates: { draggable: true, midpoints: true } } } } }),
  ] });
  draw.start(); return draw;
}
export type MapDraw = ReturnType<typeof createMapDraw>;
