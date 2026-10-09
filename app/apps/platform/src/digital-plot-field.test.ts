import { describe, expect, it } from "vitest";
import {
  demoStations,
  fieldBounds,
  fieldPixels,
  fieldValue,
} from "./digital-plot-field";
import { metricRGB, reading } from "./digital-plot-model";

describe("synthetic spatial field", () => {
  it("uses only the six labelled demo stations and reproduces their readings", () => {
    expect(demoStations).toHaveLength(6);
    expect(demoStations.map((s) => s.id)).toEqual([
      "S01",
      "S02",
      "S03",
      "S04",
      "S05",
      "S06",
    ]);
    for (const station of demoStations) {
      expect(fieldValue(...station.coordinate, 24, "moisture")).toBe(
        reading(station.plot.index, 24, "moisture"),
      );
    }
  });
  it("is continuous between parcels and changes with time and metric", () => {
    const lng = (fieldBounds[0] + fieldBounds[2]) / 2;
    const lat = (fieldBounds[1] + fieldBounds[3]) / 2;
    const value = fieldValue(lng, lat, 24, "moisture");
    expect(
      Math.abs(value - fieldValue(lng + 1e-8, lat, 24, "moisture")),
    ).toBeLessThan(0.001);
    expect(fieldValue(lng, lat, 48, "moisture")).not.toBe(value);
    expect(fieldValue(lng, lat, 24, "temperature")).not.toBe(value);
    const stations = demoStations.map((s) =>
      reading(s.plot.index, 24, "moisture"),
    );
    expect(value).toBeGreaterThanOrEqual(Math.min(...stations));
    expect(value).toBeLessThanOrEqual(Math.max(...stations));
  });
  it("clips color to parcel footprints and matches the legend endpoints", () => {
    const pixels = fieldPixels(24, "moisture", true, 40, 28);
    const alpha = pixels.filter((_, i) => i % 4 === 3);
    expect(alpha).toContain(0);
    expect(alpha).toContain(255);
    expect(pixels.slice(0, 4)).toEqual(new Uint8ClampedArray(4));
    expect(metricRGB(15, "moisture")).toEqual([0, 112, 235]);
    expect(metricRGB(35, "moisture")).toEqual([239, 114, 43]);
    expect(fieldPixels(24, "moisture", false, 40, 28)).not.toEqual(pixels);
  });
});
