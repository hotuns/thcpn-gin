import { describe, expect, it } from "vitest";
import { adminChartTime, carbonFluxCurves, carbonPhaseCurves, prepareAdminCurve } from "./admin-chart-model";

describe("administrator data curves", () => {
  it("preserves raw observations and explicit gaps while sorting equivalent timezones", () => {
    const result = prepareAdminCurve([
      { ts: "2026-10-28T08:03:00+08:00", value: 3.6 },
      { ts: "2026-10-28T00:00:00Z", value: 3.4 },
      { ts: "2026-10-28T08:01:00+08:00", value: null },
      { ts: "2026-10-28T00:02:00Z", value: Number.NaN },
      { ts: "bad timestamp", value: 90 },
    ]);
    expect(result.data.map(point => point.value)).toEqual([3.4, null, null, 3.6]);
    expect(result).toMatchObject({ count: 2, minimum: 3.4, maximum: 3.6, rejectedTimes: 1 });
    expect(result.latest).toEqual({ time: Date.parse("2026-10-28T00:03:00Z"), value: 3.6 });
  });

  it("does not sample away peaks, repeated observations or missing trailing data", () => {
    const points = Array.from({ length: 5000 }, (_, index) => ({ ts: new Date(index * 1000).toISOString(), value: index === 2001 ? 999 : 0 }));
    points.push({ ts: points[2001].ts, value: -1 });
    const result = prepareAdminCurve([...points, { ts: new Date(6000000).toISOString(), value: null }]);
    expect(result.data).toHaveLength(5002);
    expect(result.count).toBe(5001);
    expect(result.maximum).toBe(999);
    expect(result.minimum).toBe(-1);
    expect(result.latest?.value).toBe(0);
    expect(result.data.at(-1)?.value).toBeNull();
  });

  it("uses empty statistics for a series without finite readings", () => {
    expect(prepareAdminCurve([{ ts: "2026-10-28T00:00:00Z", value: Infinity }])).toMatchObject({ count: 0, minimum: undefined, maximum: undefined, latest: undefined });
  });

  it("shows axis labels in Beijing time independently of the browser timezone", () => {
    expect(adminChartTime(Date.parse("2026-10-28T00:00:00Z"))).toContain("08:00");
  });

  it("keeps absent carbon flux values as gaps, not zero", () => {
    const curves = carbonFluxCurves([{ node_id: 1, period: "p1", period_at: "2026-10-28T00:00:00Z", field: "A", nee: -3, er: 0 }]);
    expect(curves.map(item => prepareAdminCurve(item.points).count)).toEqual([1, 1, 0]);
    expect(curves[0].unit).toBe("μg CO₂·m⁻²·s⁻¹");
  });

  it("shows available carbon raw sensors with their own units and preserves missing readings", () => {
    const curves = carbonPhaseCurves({ room: "black", field: "A", complete: true, samples: 2, points: [
      { ts: "2026-10-28T00:00:00Z", co2: 400, temp_b: 18 },
      { ts: "2026-10-28T00:01:00Z", co2: 410 },
    ] });
    expect(curves.map(item => [item.code, item.unit])).toEqual([["co2", "ppm"], ["temp_b", "℃"]]);
    expect(prepareAdminCurve(curves[1].points).data.map(point => point.value)).toEqual([18, null]);
  });
});
