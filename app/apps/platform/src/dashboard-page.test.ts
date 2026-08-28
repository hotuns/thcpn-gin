import { describe, expect, it } from "vitest";
import { countState } from "./dashboard-page";

describe("dashboard metric states", () => {
  it("does not turn loading or failed queries into zero", () => {
    expect(countState(true, null)).toEqual({ value: "…", meta: "正在加载" });
    expect(countState(false, new Error("failed"))).toEqual({ value: "—", meta: "查询失败" });
    expect(countState(false, null, 0)).toEqual({ value: "0", meta: "当前组织" });
  });
});
