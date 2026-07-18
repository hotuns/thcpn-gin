import { describe, expect, it, vi } from "vitest";
import { querySelectedTelemetry, querySelectedTelemetryRaw } from "./device-query-actions";
const input = { startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" };
describe("selected telemetry queries", () => {
  it("returns no series when no metric is selected", async () => { const client = { device: vi.fn(), dataStream: vi.fn() } as any; const result = await querySelectedTelemetry("d1", [], input, client); expect(result.series).toEqual([]); expect(client.device).not.toHaveBeenCalled(); expect(client.dataStream).not.toHaveBeenCalled(); });
  it("queries selected streams in adaptive mode and merges their series", async () => { const client = { device: vi.fn(), dataStream: vi.fn((id: string) => Promise.resolve({ series: [{ data_stream_id: id, points: [] }] })) } as any; const result = await querySelectedTelemetry("d1", ["s1", "s2"], input, client); expect(client.dataStream).toHaveBeenCalledTimes(2); expect(client.dataStream).toHaveBeenCalledWith("s1", expect.objectContaining({ adaptive: true, limit: 5000, targetPoints: 1000 })); expect(result.series.map((item) => item.data_stream_id)).toEqual(["s1", "s2"]); });
  it("queries raw telemetry separately for the detail table", async () => { const client = { device: vi.fn(), dataStream: vi.fn(() => Promise.resolve({ series: [] })) } as any; await querySelectedTelemetryRaw("d1", ["s1"], input, 500, client); expect(client.dataStream).toHaveBeenCalledWith("s1", { ...input, limit: 500 }); });
});
