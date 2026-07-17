import { describe, expect, it } from "vitest";
import { healthyTelemetryQuality } from "./telemetry-charts";

describe("telemetry quality", () => {
  it("accepts backend healthy quality aliases", () => {
    expect(["good", "valid", "ok"].every(healthyTelemetryQuality)).toBe(true);
    expect(healthyTelemetryQuality("invalid")).toBe(false);
  });
});
