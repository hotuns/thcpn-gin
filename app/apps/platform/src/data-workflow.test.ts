import { describe, expect, it } from "vitest";
import {
  dataComparisonPath,
  datasetCreatePath,
  encodeComparisonSeeds,
  parseComparisonSeeds,
} from "./data-workflow";

describe("data workflow paths", () => {
  const seeds = [
    { deviceId: "device-1", streamId: "stream-1" },
    { deviceId: "device-2", streamId: "stream-2" },
  ];

  it("round trips comparison selections", () => {
    const timedSeeds = [
      {
        ...seeds[0],
        startTime: "2026-07-25T12:00",
        endTime: "2026-07-26T12:00",
      },
    ];
    expect(parseComparisonSeeds(encodeComparisonSeeds(timedSeeds))).toEqual(timedSeeds);
  });

  it("ignores invalid comparison selections", () => {
    expect(parseComparisonSeeds("invalid")).toEqual([]);
    expect(parseComparisonSeeds(JSON.stringify([{ deviceId: "", streamId: "stream" }]))).toEqual([]);
  });

  it("builds a comparison path with the selected range", () => {
    const url = new URL(
      dataComparisonPath(seeds, "2026-07-25T12:00", "2026-07-26T12:00"),
      "http://localhost",
    );
    expect(url.pathname).toBe("/data-compare");
    expect(parseComparisonSeeds(url.searchParams.get("items"))).toEqual(seeds);
    expect(url.searchParams.get("start")).toBe("2026-07-25T12:00");
    expect(url.searchParams.get("end")).toBe("2026-07-26T12:00");
  });

  it("builds a prefilled dataset path", () => {
    const url = new URL(
      datasetCreatePath({
        sourceIds: ["stream-1", "stream-2"],
        startTime: "2026-07-25T12:00",
        endTime: "2026-07-26T12:00",
        name: "设备遥测数据",
      }),
      "http://localhost",
    );
    expect(url.pathname).toBe("/datasets/new");
    expect(url.searchParams.get("sources")).toBe("stream-1,stream-2");
    expect(url.searchParams.get("name")).toBe("设备遥测数据");
  });
});
