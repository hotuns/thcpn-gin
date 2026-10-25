import { describe, expect, it, vi } from "vitest";
import type { Map } from "maplibre-gl";
import { deviceKind, deviceKinds, deviceSymbolId, deviceSymbolSvg, symbolState } from "./device-symbols";
import { deviceLayerIds, deviceSymbolFeatures, NativeDeviceLayer } from "./native-device-layer";
vi.mock("./device-symbols", async importOriginal => ({ ...await importOriginal<typeof import("./device-symbols")>(), rasterizeDeviceSymbol: vi.fn().mockResolvedValue({ width: 128, height: 160, data: new Uint8Array(128 * 160 * 4) }) }));

describe("native device cartography", () => {
  it("provides distinct local icons for every category, state and selection", () => {
    expect(deviceKind("gateway_node")).toBe("node"); expect(deviceKind("carbon_sink")).toBe("carbon"); expect(deviceKind("unexpected")).toBe("unknown");
    expect(symbolState("active")).toBe("active"); expect(symbolState("error")).toBe("alert");
    const icons = deviceKinds.flatMap(kind => ["active", "inactive", "alert", "unknown"].flatMap(status => [false, true].map(selected => deviceSymbolSvg(kind, symbolState(status), selected))));
    expect(new Set(icons).size).toBe(56);
    expect(icons.every(svg => svg.includes('viewBox="0 0 64 80"') && !svg.includes("http", svg.indexOf("<path")))).toBe(true);
  });
  it("validates coordinates and encodes selection without inventing online status", () => {
    const rows = [{ device_id: "a", name: "A", device_type: "gateway", status: "active", longitude: 116, latitude: 40 }];
    expect(deviceSymbolFeatures([...rows, { ...rows[0], latitude: 100 }], "a").features).toHaveLength(1);
    expect(deviceSymbolFeatures(rows, "a").features[0].properties.icon).toBe(deviceSymbolId("gateway", "active", true));
  });
  it("updates a single GPU source, preserves native layers, handles click/cluster and cleans up", async () => {
    const listeners = new globalThis.Map<string, (...args: any[]) => void>();
    const images = new Set<string>(); const setData = vi.fn(); const select = vi.fn(); const easeTo = vi.fn();
    const source = { setData, getClusterExpansionZoom: vi.fn().mockResolvedValue(15) };
    const map = { on: vi.fn((event: string, layerOrFn: string | (() => void), fn?: () => void) => listeners.set(`${event}:${typeof layerOrFn === "string" ? layerOrFn : ""}`, fn ?? layerOrFn as () => void)), off: vi.fn(), isStyleLoaded: () => true, addSource: vi.fn(), addLayer: vi.fn(), getSource: () => source, getLayer: () => ({}), removeSource: vi.fn(), removeLayer: vi.fn(), hasImage: (id: string) => images.has(id), addImage: vi.fn((id: string) => images.add(id)), easeTo, getCanvas: () => ({ style: {} }) };
    const renderer = new NativeDeviceLayer(map as unknown as Map, select);
    const rows = [{ device_id: "a", name: "A", device_type: "standard", status: "active", longitude: 116, latitude: 40 }];
    renderer.update(rows, "a"); await Promise.resolve(); await Promise.resolve();
    renderer.update([...rows], "a");
    expect(map.addSource).toHaveBeenCalledOnce(); expect(map.addLayer).toHaveBeenCalledTimes(4);
    expect(easeTo).not.toHaveBeenCalled();
    expect(map.addLayer.mock.calls.some(call => call[0].type === "symbol" && call[0].layout["icon-anchor"] === "bottom")).toBe(true);
    listeners.get(`click:${deviceLayerIds.symbol}`)!({ features: [{ properties: { device_id: "a" } }] }); expect(select).toHaveBeenCalledWith("a");
    await listeners.get(`click:${deviceLayerIds.cluster}`)!({ features: [{ properties: { cluster_id: 2 }, geometry: { type: "Point", coordinates: [116, 40] } }] });
    expect(easeTo).toHaveBeenCalledWith({ center: [116, 40], zoom: 15 });
    renderer.dispose(); expect(map.removeLayer).toHaveBeenCalledTimes(4); expect(map.removeSource).toHaveBeenCalledWith(deviceLayerIds.source);
  });
});
