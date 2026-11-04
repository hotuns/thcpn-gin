import { expect, it } from "vitest";
import type { DataStream } from "@thcpn/api";
import { defaultMetricIds, preferenceKey, readMetricPreference } from "../../apps/platform/src/features/atlas/atlas-metric-preferences";
const metrics: DataStream[] = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, code: `metric${index}`, name: `指标${index}`, type: "telemetry", purpose: index === 0 ? "status" : "measurement", status: "active", device_id: "device", computed: false, created_by: "user", created_at: "2026-11-03T00:00:00Z", updated_at: "2026-11-03T00:00:00Z" }));
it("defaults use ordered codes supported by this device/node and cap cards at six", () => {
  expect(defaultMetricIds(metrics, ["metric3", "unknown", "metric1"])).toEqual(["s3", "s1"]);
  expect(defaultMetricIds(metrics, ["unknown"])).toEqual([]);
  expect(defaultMetricIds(metrics, [])).toEqual([]);
  expect(defaultMetricIds(metrics, metrics.map(stream => stream.code))).toHaveLength(6);
  expect(defaultMetricIds(metrics)).toEqual(["s1", "s2", "s3", "s4"]);
  expect(defaultMetricIds(metrics, undefined, ["s2", "missing"])).toEqual(["s2"]);
});
it("preferences remain isolated by user, workspace, board, device and node", () => {
  const base = ["user", "workspace", "board", "device", "node"] as const;
  const key = preferenceKey(...base);
  for (let index = 0; index < base.length; index++) {
    const changed: [string, string, string, string, string] = [...base];
    changed[index] += "-other";
    expect(preferenceKey(...changed)).not.toBe(key);
  }
  localStorage.setItem(key, JSON.stringify(["s3", "s1"]));
  expect(readMetricPreference(key)).toEqual(["s3", "s1"]);
  localStorage.setItem(key, "[]");
  expect(readMetricPreference(key)).toEqual([]);
  localStorage.setItem(key, "broken");
  expect(readMetricPreference(key)).toBeNull();
  localStorage.setItem(key, JSON.stringify([5]));
  expect(readMetricPreference(key)).toBeNull();
});
