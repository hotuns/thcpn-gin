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
  it.each(["", "10", "10 20 30", "60 10", "10 24", "-1 10", "1.5 10", "10, 10", "*,10 10", "10 *x", "0-20 10", "1e1 10"])("does not guess unsupported or malformed input %s", content => {
    expect(parseNodeTimeSchedule(content)).toEqual({valid:false});
  });
  it("keeps dense schedules readable without changing execution semantics", () => {
    expect(describeNodeTimeSchedule("0,10,20,30,40,50 0,1,2")).toContain("共 18 次");
  });
  it("expands wildcard hours and describes the node 100 configuration", () => {
    const parsed = parseNodeTimeSchedule("10,20,30 *");
    expect(parsed.valid && parsed.times.length).toBe(72);
    expect(parsed.valid && parsed.times.slice(-3)).toEqual(["23:10", "23:20", "23:30"]);
    expect(describeNodeTimeSchedule("10,20,30 *")).toBe("每小时的 10、20、30 分启动采集，共 72 次/天");
    expect(describeNodeTimeSchedule("10,20,30 *", "en-US")).toContain("every hour");
  });
  it("expands wildcard minutes within the selected hours", () => {
    const parsed = parseNodeTimeSchedule("* 10,12");
    expect(parsed.valid && parsed.times.length).toBe(120);
    expect(parsed.valid && parsed.times[59]).toBe("10:59");
    expect(describeNodeTimeSchedule("* 10,12")).toContain("每天 10、12 点的每分钟");
    expect(describeNodeTimeSchedule("* 10", "en-US")).toContain("every minute");
  });
  it("describes both wildcards compactly", () => {
    const parsed = parseNodeTimeSchedule(" *\t* ");
    expect(parsed.valid && parsed.times.length).toBe(1440);
    expect(describeNodeTimeSchedule("* *")).toBe("全天每分钟启动采集，共 1440 次/天");
    expect(describeNodeTimeSchedule("* *", "en-US")).toContain("1440 starts per day");
  });
});
