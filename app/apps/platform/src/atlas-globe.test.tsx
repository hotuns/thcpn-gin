// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AtlasMap } from "./atlas-map";

const scene = vi.hoisted(() => ({
  events: {} as Record<string, () => void>,
  projection: vi.fn(), camera: vi.fn(), terrain: vi.fn(), remove: vi.fn(),
}));
vi.mock("maplibre-gl", () => ({
  Map: class {
    on(name: string, callback: () => void) { scene.events[name] = callback; }
    off() {}
    getLayer() { return false; }
    getSource() { return {}; }
    addControl() {}
    getCenter() { return { lng: 116, lat: 40 }; }
    getZoom() { return 12; }
    getBearing() { return 15; }
    getContainer() { return { clientWidth: 1500 }; }
    setTerrain = scene.terrain;
    setSky() {}
    setProjection = scene.projection;
    easeTo = scene.camera;
    resize() {}
    remove = scene.remove;
  },
  ScaleControl: class {}, Marker: class {}, LngLatBounds: class {},
}));

it("switches to a globe without DEM and restores the regional camera without remounting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AtlasMap points={[]} selectedId="" onSelect={() => {}} reset={0} onReset={() => {}} />));
    await act(async () => scene.events.load());
    const buttons = container.querySelectorAll<HTMLButtonElement>(".atlas-map-actions button");
    expect(buttons).toHaveLength(3);
    await act(async () => buttons[2].click());
    expect(scene.projection).toHaveBeenLastCalledWith({ type: "globe" });
    expect(scene.terrain).toHaveBeenLastCalledWith(null);
    expect(scene.camera).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 1.1, pitch: 0 }));
    expect(buttons[1].disabled).toBe(true);
    await act(async () => buttons[2].click());
    expect(scene.projection).toHaveBeenLastCalledWith({ type: "mercator" });
    expect(scene.camera).toHaveBeenLastCalledWith(expect.objectContaining({ center: [116, 40], zoom: 12, bearing: 15 }));
    expect(buttons[1].disabled).toBe(false);
    expect(scene.remove).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
  expect(scene.remove).toHaveBeenCalledOnce();
});
