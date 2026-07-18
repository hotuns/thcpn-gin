import { describe, expect, it } from "vitest";
import { describeSamplingControl, scheduleSummary } from "./sampling-profile";

describe("sampling profile display", () => {
  it("describes supported two-field schedules", () => {
    expect(describeSamplingControl({ data_capture_invl: "0,30 *", img_capture_invl: "10 8,10,14,16" }))
      .toBe("每小时 00、30 分采集数据；每天 08:10、10:10、14:10、16:10 采集图片");
  });

  it("labels unsupported cron expressions as advanced", () => {
    expect(describeSamplingControl({ data_capture_invl: "*/5 *", img_capture_invl: "10 8" }))
      .toBe("管理员高级自定义计划");
  });

  it("sorts custom values", () => {
    expect(scheduleSummary([40, 0, 20], 10, [18, 8])).toContain("00、20、40");
  });
});
