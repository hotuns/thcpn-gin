import { describe, expect, it } from "vitest";
import type { DataStream } from "@thcpn/api";
import { buildDataQuickNavItems } from "./data-quick-navigator";

describe("data page quick navigation", () => {
  it("keeps one stable anchor for every image stream", () => {
    const streams = ["visible", "near-infrared", "thermal", "depth"].map(
      (id, index) =>
        ({ id, name: `图片类型 ${index + 1}` }) as DataStream,
    );
    const items = buildDataQuickNavItems(streams);

    expect(items.slice(0, 4).map((item) => item.id)).toEqual([
      "data-section-metrics",
      "data-section-trend",
      "data-section-detail",
      "data-section-images",
    ]);
    expect(items[0].label).toBe("查询条件");
    expect(items.slice(4).map((item) => item.id)).toEqual(
      streams.map((stream) => `data-image-${stream.id}`),
    );
  });
});
