import { describe, expect, it } from "vitest";
import { sourceDateValue } from "./source-date";

describe("source log calendar dates", () => {
  it("keeps Beijing's day/month/year through UTC midnight boundaries", () => {
    expect(sourceDateValue(new Date("2026-10-19T16:16:37Z"))).toBe("2026-10-20");
    expect(sourceDateValue(new Date("2026-09-30T16:00:00Z"))).toBe("2026-10-01");
    expect(sourceDateValue(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
    expect(sourceDateValue(new Date("2026-10-20T00:00:00Z"))).toBe("2026-10-20");
  });
});
