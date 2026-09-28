import { expect, it, vi } from "vitest";
import { api } from "@thcpn/api";
import { fullTelemetry } from "./full-telemetry";

it("splits truncated ranges, keeps all raw points and deduplicates the boundary", async () => {
  const startTime = "2026-01-01T00:00:00.000Z";
  const endTime = "2026-01-01T02:00:00.000Z";
  const mid = "2026-01-01T01:00:00.000Z";
  const response = (timestamps: string[], complete: boolean): Awaited<ReturnType<typeof api.telemetry.device>> => ({
    device_id: "d", start_time: startTime, end_time: endTime, limit: 5000,
    series: [{ data_stream_id: "s", code: "diams", name: "diams", points: timestamps.map(ts => ({ ts, value: 1, quality: "valid" })), complete, sampled: false, source_count: timestamps.length, returned_count: timestamps.length }],
  });
  const device = vi.spyOn(api.telemetry, "device")
    .mockResolvedValueOnce(response([startTime], false))
    .mockResolvedValueOnce(response([startTime, mid], true))
    .mockResolvedValueOnce(response([mid, endTime], true));
  try {
    const result = await fullTelemetry("d", { startTime, endTime });
    expect(result.series[0].points.map(point => point.ts)).toEqual([startTime, mid, endTime]);
    expect(result.series[0].sampled).toBe(false);
    expect(result.series[0].complete).toBe(true);
    expect(device).toHaveBeenCalledTimes(3);
    expect(device.mock.calls.every(([, input]) => input.adaptive === false)).toBe(true);
  } finally { device.mockRestore(); }
});
