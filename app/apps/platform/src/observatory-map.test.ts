// @vitest-environment jsdom
import type { Map } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  motionDuration,
  satelliteStyle,
  setSceneTerrain,
  terrainSource,
} from "./observatory-map";

afterEach(() => vi.unstubAllGlobals());
describe("observatory map rendering", () => {
  it("adds DEM only once and can return to a plain map without removing the basemap", () => {
    const getSource = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValue({});
    const addSource = vi.fn();
    const setTerrain = vi.fn();
    const setSky = vi.fn();
    const map = { getSource, addSource, setTerrain, setSky } as unknown as Map;
    setSceneTerrain(map, true);
    setSceneTerrain(map, true);
    setSceneTerrain(map, false);
    expect(addSource).toHaveBeenCalledExactlyOnceWith(
      "observatory-dem",
      terrainSource,
    );
    expect(setTerrain).toHaveBeenLastCalledWith(null);
    expect(terrainSource.encoding).toBe("terrarium");
    expect(satelliteStyle().sources).toHaveProperty("satellite.attribution");
  });
  it("respects the system reduced-motion preference", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(motionDuration()).toBe(0);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    expect(motionDuration()).toBe(700);
  });
});
