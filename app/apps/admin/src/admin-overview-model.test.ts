import { describe, expect, it } from "vitest";
import { formatOverviewTime } from "./admin-overview-model";

describe("admin overview time formatting", () => {
  it("formats React Query millisecond timestamps", () => {
    expect(formatOverviewTime(1785374005993, "zh-CN")).not.toBe("—");
  });

  it("does not crash the overview for an invalid log timestamp", () => {
    expect(formatOverviewTime("invalid", "zh-CN")).toBe("—");
  });
});
