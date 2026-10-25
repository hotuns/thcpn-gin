import { describe, expect, it } from "vitest";
import { applyParcelOverrides, geometryMeasure, parseParcelOverrides, validParcelRing } from "./map-tools-model";
import { plots } from "./digital-plot-model";
describe("geographic workbench boundaries", () => {
  it("accepts all original demo parcels and rejects invalid/outside/self-intersecting polygons", () => {
    expect(plots.every(p => validParcelRing(p.coordinates))).toBe(true);
    expect(validParcelRing([[0,0],[1,0],[1,1],[0,0]])).toBe(false);
    expect(validParcelRing(plots[0].coordinates.slice(0,-1))).toBe(false);
    const [x,y] = plots[2].center;
    expect(validParcelRing([[x,y],[x+.001,y+.001],[x,y+.001],[x+.002,y],[x,y]])).toBe(false);
  });
  it("loads only known validated local overrides, never mutating fixtures", () => {
    const ring = plots[2].coordinates.map(q => [...q]);
    const overrides = parseParcelOverrides(JSON.stringify({ P03: ring, evil: ring, P02: [[1,2]] }));
    expect(Object.keys(overrides)).toEqual(["P03"]);
    const next = applyParcelOverrides(overrides);
    expect(next[2]).not.toBe(plots[2]); expect(next[2].area).toBeGreaterThan(0);
    expect(next[0]).toBe(plots[0]);
    expect(parseParcelOverrides("not json")).toEqual({});
  });
  it("calculates geodesic length and area with explicit units", () => {
    expect(geometryMeasure({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [plots[2].coordinates] } })).toMatch(/ha.*m 周长/);
    expect(geometryMeasure({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: plots[2].coordinates.slice(0,2) } })).toMatch(/\d+\.\d m/);
  });
});
