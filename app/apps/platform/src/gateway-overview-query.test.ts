import { afterEach, expect, it, vi } from "vitest";
import { api } from "@thcpn/api";
import { queryNodeStatus } from "./gateway-overview-query";
afterEach(() => vi.restoreAllMocks());
const input = { startTime: "2026-10-01T00:00:00Z", endTime: "2026-10-08T00:00:00Z" };
function result(points: Array<{ ts: string; value: number; quality: string }>, complete: boolean): Awaited<ReturnType<typeof api.telemetry.device>> {
  return { device_id: "d", start_time: input.startTime, end_time: input.endTime, limit: 1, series: [{ data_stream_id: "s", code: "temp", name: "温度", points, complete, sampled: false, source_count: points.length, returned_count: points.length }] };
}
it("reads only the latest record for a node with valid data", async () => {
  const request = vi.spyOn(api.telemetry, "device").mockResolvedValue(result([{ ts: input.endTime, value: 1, quality: "valid" }], false));
  await queryNodeStatus("d", input);
  expect(request).toHaveBeenCalledExactlyOnceWith("d", { ...input, adaptive: false, limit: 1 });
});
it("checks history when the newest row lacks configured metrics", async () => {
  const request = vi.spyOn(api.telemetry, "device").mockResolvedValueOnce(result([], false)).mockResolvedValueOnce(result([], true));
  await queryNodeStatus("d", input);
  expect(request).toHaveBeenCalledTimes(2);
});
it("does not scan again for an empty completed range", async () => {
  const request = vi.spyOn(api.telemetry, "device").mockResolvedValue(result([], true));
  await queryNodeStatus("d", input);
  expect(request).toHaveBeenCalledTimes(1);
});
