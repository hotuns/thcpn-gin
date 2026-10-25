// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Map } from "maplibre-gl";
import { NativeDeviceLayer, deviceLayerIds } from "../packages/device-map/src/native-device-layer";

// Keep MapLibre's actual popup DOM shape and CSS, without requiring WebGL in jsdom.
vi.mock("maplibre-gl", () => ({
  Popup: class {
    element = document.createElement("div");
    content = document.createElement("div");
    constructor(options: { className?: string }) {
      this.element.className = `maplibregl-popup maplibregl-popup-anchor-bottom ${options.className ?? ""}`;
      const tip = document.createElement("div"); tip.className = "maplibregl-popup-tip";
      this.content.className = "maplibregl-popup-content";
      this.element.append(tip, this.content);
    }
    setLngLat() { return this; }
    setText(text: string) { this.content.textContent = text; return this; }
    addTo(map: { getContainer: () => HTMLElement }) { map.getContainer().append(this.element); return this; }
    remove() { this.element.remove(); }
  },
}));

function luminance(color: string) {
  const [r, g, b] = color.match(/\d+/g)!.slice(0, 3).map(Number).map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
}

afterEach(() => { document.body.replaceChildren(); document.head.replaceChildren(); });
describe("device hover popup readability", () => {
  it.each(["#17212b", "#e9f5ff"])("keeps readable text when its map inherits %s", inherited => {
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve("node_modules/maplibre-gl/dist/maplibre-gl.css"), "utf8") + readFileSync(resolve("packages/device-map/src/styles.css"), "utf8");
    document.head.append(style);
    const host = document.createElement("div"); host.style.color = inherited; document.body.append(host);
    const events = new globalThis.Map<string, (event: unknown) => void>();
    const map = {
      isStyleLoaded: () => true, getStyle: () => ({ version: 8 }),
      on: (event: string, layer: string | (() => void), handler?: (event: unknown) => void) => { if (handler) events.set(`${event}:${layer}`, handler); },
      off: vi.fn(), addSource: vi.fn(), addLayer: vi.fn(), getSource: () => ({ setData: vi.fn() }),
      getLayer: () => ({}), removeLayer: vi.fn(), removeSource: vi.fn(),
      getCanvas: () => ({ style: {} }), getContainer: () => host,
    };
    const layer = new NativeDeviceLayer(map as unknown as Map, vi.fn());
    events.get(`mouseenter:${deviceLayerIds.symbol}`)!({ features: [{ geometry: { type: "Point", coordinates: [116, 40] }, properties: { name: "<Station> long device name" } }] });
    const content = host.querySelector<HTMLElement>(".maplibregl-popup-content")!;
    const computed = getComputedStyle(content);
    const foreground = luminance(computed.color), background = luminance(computed.backgroundColor);
    expect((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)).toBeGreaterThanOrEqual(4.5);
    expect(content.querySelector("station")).toBeNull();
    expect(content.textContent).toBe("<Station> long device name");
    expect(parseFloat(computed.fontSize)).toBeGreaterThanOrEqual(13);
    layer.dispose(); expect(host.querySelector(".maplibregl-popup")).toBeNull();
  });
});
