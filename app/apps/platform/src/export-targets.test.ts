import { describe, expect, it } from "vitest";
import { resolveExportTargets } from "./export-targets";

describe("export target identification", () => {
  it("shows every station's name and serial number for an existing batch job", () => {
    const result = resolveExportTargets({ export_type: "standard_station_zip", resource_type: "device_batch", resource_id: "a", request_config: { device_ids: ["a", "b"] } }, [
      { id: "a", name: "森林站", serial_no: "EC-001" },
      { id: "b", name: "草地站", serial_no: "EC-002" },
    ]);
    expect(result.countLabel).toBe("2 台设备");
    expect(result.items.map(item => [item.name, item.description])).toEqual([["森林站", "SN EC-001"], ["草地站", "SN EC-002"]]);
  });

  it("counts LoRa nodes instead of the shared gateway device ID", () => {
    const result = resolveExportTargets({ export_type: "group_site_zip", resource_type: "device_batch", resource_id: "g", request_config: {
      device_ids: ["g"], gateway_id: "g", gateway_name: "LoRa 网关",
      node_targets: [{ kind: "gateway_node", gateway_device_id: "g", node_index: 1 }, { kind: "gateway_node", gateway_device_id: "g", node_index: 100 }],
      node_names: { "gateway:g:node:1": "样地一", "gateway:g:node:100": "样地一百" },
    } }, [{ id: "g", name: "新网关名称", serial_no: "GW-001" }]);
    expect(result.station).toMatchObject({ name: "LoRa 网关", description: "SN GW-001" });
    expect(result.countLabel).toBe("2 个节点");
    expect(result.items.map(item => item.name)).toEqual(["样地一", "样地一百"]);
  });

  it("preserves saved THCPN node names even when the device is no longer listed", () => {
    const result = resolveExportTargets({ export_type: "group_site_zip", resource_type: "device_batch", resource_id: "n", request_config: { device_ids: ["n"], node_names: { n: "五角枫" } } }, []);
    expect(result.items[0]).toMatchObject({ name: "五角枫", description: "设备 ID n" });
  });

  it("identifies the carbon station, selected nodes and plots", () => {
    const result = resolveExportTargets({ export_type: "carbon_station_zip", resource_type: "device", resource_id: "c", request_config: { node_ids: [2, 3], fields: ["A", "B"], node_names: { "2": "林地" } } }, [{ id: "c", name: "碳汇观测站", serial_no: "C-001" }]);
    expect(result.station?.name).toBe("碳汇观测站");
    expect(result.countLabel).toBe("2 个 Node · 2 个地块");
    expect(result.items.map(item => item.name)).toEqual(["林地", "Node 3"]);
    expect(result.fields).toEqual(["A", "B"]);
  });

  it("keeps a single-device task identifiable if its device is unavailable", () => {
    const result = resolveExportTargets({ export_type: "telemetry_excel", resource_type: "device", resource_id: "removed-id", request_config: {} }, []);
    expect(result.items[0].description).toBe("设备 ID removed-id");
  });
});
