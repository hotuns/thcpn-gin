import { describe, expect, it, vi } from "vitest";
import { api, type TelemetryPoint, type TelemetryQueryResponse, type TelemetrySeries } from "@thcpn/api";
import { fullTelemetry } from "../../apps/platform/src/shared/telemetry/full-telemetry";

const start = "2026-01-01T00:00:00.000Z";
const second2 = "2026-01-01T00:00:02.000Z";
const second4 = "2026-01-01T00:00:04.000Z";
const end = "2026-01-01T00:00:08.000Z";

function series(id: string, points: TelemetryPoint[], complete = true): TelemetrySeries {
  return {
    data_stream_id: id,
    code: id,
    name: id,
    points,
    source_count: points.length,
    returned_count: points.length,
    sampled: false,
    complete,
  };
}

function response(items: TelemetrySeries[]): TelemetryQueryResponse {
  return { device_id: "station", start_time: start, end_time: end, limit: 5000, series: items };
}

const point = (ts: string, value: number): TelemetryPoint => ({ ts, value, quality: "good" });

function clientWith(device: typeof api.telemetry.device) {
  return { ...api.telemetry, device };
}

describe("full telemetry queries", () => {
  it("requests unsampled data and returns a complete response without splitting", async () => {
    const complete = response([series("temperature", [point(start, 20)])]);
    const device = vi.fn<typeof api.telemetry.device>().mockResolvedValue(complete);

    const result = await fullTelemetry("station", {
      startTime: start, endTime: end, adaptive: true, limit: 1, dataStreamIds: ["temperature"],
    }, clientWith(device));

    expect(result).toEqual(complete);
    expect(device).toHaveBeenCalledExactlyOnceWith("station", {
      startTime: start, endTime: end, adaptive: false, limit: 5000, dataStreamIds: ["temperature"],
    });
  });

  it("recursively retrieves capped windows and merges each stream in time order without duplicate boundaries", async () => {
    const stored = [
      series("temperature", [point(start, 20), point(second2, 22), point(second4, 24), point(end, 28)]),
      series("humidity", [point(start, 60), point(second2, 62), point(second4, 64), point(end, 68)]),
    ];
    // Simulate an inclusive API capped at two points per stream, with no ordering guarantee.
    const device = vi.fn<typeof api.telemetry.device>().mockImplementation(async (_id, input) => {
      const items = stored.map(item => {
        const matching = item.points.filter(point => point.ts >= input.startTime && point.ts <= input.endTime);
        return series(item.data_stream_id, matching.slice(0, 2).reverse(), matching.length <= 2);
      });
      return response(input.startTime === start ? items : items.reverse());
    });
    const dataStreamIds = ["temperature", "humidity"];

    const result = await fullTelemetry("station", {
      startTime: start, endTime: end, dataStreamIds,
    }, clientWith(device));

    expect(result.series).toEqual([
      expect.objectContaining({
        data_stream_id: "temperature",
        points: [point(start, 20), point(second2, 22), point(second4, 24), point(end, 28)],
        complete: true, sampled: false, source_count: 4, returned_count: 4,
      }),
      expect.objectContaining({
        data_stream_id: "humidity",
        points: [point(start, 60), point(second2, 62), point(second4, 64), point(end, 68)],
        complete: true, sampled: false, source_count: 4, returned_count: 4,
      }),
    ]);
    expect(device.mock.calls.length).toBeGreaterThan(1);
    for (const [id, input] of device.mock.calls) {
      expect(id).toBe("station");
      expect(input).toMatchObject({ dataStreamIds, adaptive: false, limit: 5000 });
    }
  });

  it("preserves a failed stream and available successful data without recursively retrying the failure", async () => {
    const partial = response([
      { ...series("temperature", [], false), error: "data source unavailable" },
      series("humidity", [point(start, 60)]),
    ]);
    const device = vi.fn<typeof api.telemetry.device>().mockResolvedValue(partial);

    await expect(fullTelemetry("station", { startTime: start, endTime: end }, clientWith(device)))
      .resolves.toEqual(partial);
    expect(device).toHaveBeenCalledTimes(1);
  });

  it("rejects an incomplete two-second window instead of returning truncated data or splitting forever", async () => {
    const device = vi.fn<typeof api.telemetry.device>()
      .mockResolvedValue(response([series("temperature", [], false)]));

    await expect(fullTelemetry("station", {
      startTime: start, endTime: second4,
    }, clientWith(device))).rejects.toThrow(/2 秒.*数据导出/);
    expect(device).toHaveBeenCalledTimes(2);
    expect(device).toHaveBeenLastCalledWith("station", expect.objectContaining({
      startTime: start, endTime: second2,
    }));
  });
});
