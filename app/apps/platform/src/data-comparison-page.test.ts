import { describe, expect, it } from "vitest";
import type { TelemetrySeries } from "@thcpn/api";
import { comparisonStatistic, groupComparisonDrafts } from "./data-comparison-page";

describe("comparisonStatistic", () => {
  it("computes raw statistics and quality", () => {
    const series = {
      source_count: 4,
      points: [
        { ts: "2026-07-01T00:00:00Z", value: 1, quality: "good" },
        { ts: "2026-07-01T01:00:00Z", value: 3, quality: "valid" },
        { ts: "2026-07-01T02:00:00Z", value: 5, quality: "bad" },
      ],
    } as TelemetrySeries;
    expect(comparisonStatistic(series)).toEqual({
      count: 4,
      min: 1,
      max: 5,
      average: 3,
      latest: 5,
      quality: 67,
    });
  });

  it("returns null without numeric points", () => {
    expect(comparisonStatistic({ points: [] } as unknown as TelemetrySeries)).toBeNull();
  });
});

describe("groupComparisonDrafts", () => {
  it("combines streams for the same device and time range", () => {
    const groups = groupComparisonDrafts([
      { id: "a", deviceId: "d1", streamId: "s2", startTime: "start", endTime: "end" },
      { id: "b", deviceId: "d1", streamId: "s1", startTime: "start", endTime: "end" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ deviceId: "d1", streamIds: ["s1", "s2"], itemIds: ["a", "b"] });
  });

  it("keeps different devices and ranges separate", () => {
    const groups = groupComparisonDrafts([
      { id: "a", deviceId: "d1", streamId: "s1", startTime: "start", endTime: "end" },
      { id: "b", deviceId: "d2", streamId: "s1", startTime: "start", endTime: "end" },
      { id: "c", deviceId: "d1", streamId: "s2", startTime: "later", endTime: "end" },
    ]);
    expect(groups).toHaveLength(3);
  });
});
