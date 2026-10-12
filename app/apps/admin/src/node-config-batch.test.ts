import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@thcpn/api";
import { sensorConfigTargets, submitNodeSensorBatch, type NodeConfigResult } from "./node-config-batch";

afterEach(() => vi.restoreAllMocks());

describe("node sensor configuration batch", () => {
  it("keeps the current node once and only includes selected nodes belonging to this gateway", () => {
    expect(sensorConfigTargets(1, [1, 2, 3, 4, 99], [1, 2, 3, 4], true)).toEqual([1, 2, 3, 4]);
    expect(sensorConfigTargets(2, [1, 3, 4], [1, 2, 3, 4], false)).toEqual([2]);
    expect(sensorConfigTargets(2, [], [1, 2, 3], true)).toEqual([2]);
  });

  it("continues after a failed target and distinguishes accepted-but-unsynced nodes", async () => {
    const write = vi.spyOn(api.admin, "updateDeviceSourceConfig")
      .mockResolvedValueOnce({ write_state: { platform: "synced" } })
      .mockRejectedValueOnce(new Error("upstream unavailable"))
      .mockResolvedValueOnce({ write_state: { platform: "failed" } });
    const payload = { mode: "advanced", content: [["485", []]], metrics: [{ key: "temp", name: "温度" }] };
    const updates: NodeConfigResult[][] = [];
    const results = await submitNodeSensorBatch("gateway", [1, 2, 3], payload, items => updates.push(items));
    expect(write.mock.calls).toEqual([1, 2, 3].map(index => ["gateway", "sensor", payload, index]));
    expect(results.map(item => item.status)).toEqual(["synced", "failed", "sync_failed"]);
    expect(results[1].detail).toContain("upstream unavailable");
    expect(updates[0]).toEqual([{ node: 1, status: "submitting", detail: "" }]);
    expect(updates.at(-1)).toEqual(results);
  });

  it("does not send duplicate requests for the same node", async () => {
    const write = vi.spyOn(api.admin, "updateDeviceSourceConfig").mockResolvedValue({});
    await submitNodeSensorBatch("gateway", [1, 1, 2], {}, vi.fn());
    expect(write).toHaveBeenCalledTimes(2);
  });
});
