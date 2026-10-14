import { describe, expect, it } from "vitest";
import { describeNodeTimeSchedule, parseNodeTimeSchedule } from "./node-time-schedule";

describe("node daily start schedule", () => {
  it("interprets minutes first, hours second, not as an interval", () => {
    expect(parseNodeTimeSchedule("10,20 10")).toEqual({valid:true,minutes:[10,20],hours:[10],times:["10:10","10:20"]});
    expect(describeNodeTimeSchedule("10,20 10")).toBe("每天 10:10、10:20 启动采集");
    expect(describeNodeTimeSchedule("10,20 10","en-US")).toBe("Start sampling daily at 10:10, 10:20");
  });
  it("expands multiple hours, sorts, deduplicates and accepts whitespace", () => {
    expect(parseNodeTimeSchedule(" 20,10,10\t23,0,23 ")).toEqual({valid:true,minutes:[10,20],hours:[0,23],times:["00:10","00:20","23:10","23:20"]});
    expect(parseNodeTimeSchedule("0,59 0,23").valid).toBe(true);
  });
  it.each(["", "10", "10 20 30", "60 10", "10 24", "-1 10", "1.5 10", "10, 10", "* 10", "0-20 10", "1e1 10"])("does not guess unsupported or malformed input %s", content => {
    expect(parseNodeTimeSchedule(content)).toEqual({valid:false});
  });
  it("keeps dense schedules readable without changing execution semantics", () => {
    expect(describeNodeTimeSchedule("0,10,20,30,40,50 0,1,2")).toContain("共 18 次");
  });
});
