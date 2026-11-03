import type { Map } from "maplibre-gl";
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

export function createMapDraw(map: Map) {
  // Invoke the modes' supported keyboard handler for touch completion, scoped
  // to this session rather than dispatching a global synthetic keyboard event.
  const polygon = new TerraDrawPolygonMode({ keyEvents: { finish: "Enter", cancel: "Escape" } });
  const linestring = new TerraDrawLineStringMode({ keyEvents: { finish: "Enter", cancel: "Escape" } });
  const draw = new TerraDraw({ adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }), modes: [
    polygon, linestring,
    new TerraDrawSelectMode({ flags: { polygon: { feature: { draggable: true, coordinates: { draggable: true, midpoints: true, deletable: true }, selfIntersectable: false } }, linestring: { feature: { draggable: true, coordinates: { draggable: true, midpoints: true } } } } }),
  ] });
  draw.start();
  return Object.assign(draw, {
    finishDrawing() {
      const mode = draw.getMode() === "polygon" ? polygon : draw.getMode() === "linestring" ? linestring : undefined;
      if (!mode) return false;
      if (mode === linestring && draw.getModeState() === "drawing") {
        const line = draw.getSnapshot().find(feature => feature.geometry.type === "LineString" && feature.properties.currentlyDrawing);
        // The last coordinate is the cursor preview, not a committed tap.
        const coordinates = line?.geometry.type === "LineString" ? line.geometry.coordinates.slice(0, -1) : [];
        if (new Set(coordinates.map(point => point.join(","))).size < 2) return false;
      }
      if (draw.getModeState() === "drawing") mode.onKeyUp({ key: "Enter", heldKeys: [], preventDefault() {} });
      const finished = draw.getModeState() !== "drawing" && draw.getSnapshot().some(feature => feature.properties.mode === mode.mode && !feature.properties.midPoint && !feature.properties.selectionPoint);
      if (finished) draw.setMode("select");
      return finished;
    },
  });
}
export type MapDraw = ReturnType<typeof createMapDraw>;
