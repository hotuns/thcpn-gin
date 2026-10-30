import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function edition(simplified?: string, billing = "false") {
  vi.resetModules();
  vi.stubEnv("VITE_SIMPLIFIED_ENABLED", simplified);
  vi.stubEnv("VITE_BILLING_ENABLED", billing);
  return import("./features");
}

describe("platform edition", () => {
  it("defaults to the full edition and preserves commercial configuration", async () => {
    const full = await edition(undefined, "true");
    expect(full.simplifiedEnabled).toBe(false);
    expect(full.platformHomePath).toBe("/dashboard");
    expect(full.billingEnabled).toBe(true);
    for (const path of ["/processing/task-1", "/datasets/new", "/subscription", "/register", "/public/devices/demo"])
      expect(full.platformPathAvailable(path)).toBe(true);
    expect((await edition("false")).simplifiedEnabled).toBe(false);
  });

  it("keeps viewing, export creation, settings and account routes in the simplified edition", async () => {
    const simple = await edition("true", "true");
    expect(simple.platformHomePath).toBe("/atlas");
    expect(simple.billingEnabled).toBe(false);
    for (const path of ["/login", "/atlas", "/atlas/board-1", "/devices", "/devices/device-1?tab=data", "/exports/", "/exports/new?device_id=1", "/settings?tab=access", "/account?tab=security"])
      expect(simple.platformPathAvailable(path), path).toBe(true);
  });

  it("rejects direct links to omitted pages and unknown descendants", async () => {
    const simple = await edition("true");
    for (const path of ["/", "/dashboard", "/device-map", "/alerts", "/claim/secret", "/data-compare", "/datasets", "/datasets/new", "/processing/task-1", "/workspaces", "/subscription", "/notifications", "/register", "/demo-login", "/public/devices/demo", "/atlas/topics/digital-plot", "/devices/device-1/edit", "/exports/unknown", "/unknown"])
      expect(simple.platformPathAvailable(path), path).toBe(false);
  });
});
