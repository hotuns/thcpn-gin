import { describe, expect, it } from "vitest";
import type { DeviceNodeTarget } from "@thcpn/api";
import { buildGroupExportPayload } from "../../apps/platform/src/features/exports/export-model";
import { resolveExportTargets } from "../../apps/platform/src/features/exports/export-targets";

const start = "2026-01-01T00:00:00.000Z";
const end = "2026-01-02T00:00:00.000Z";
const gateway = { id: "gateway-a", name: "North station" };

describe("group export targets", () => {
  it("preserves indexed node identities while deduplicating backing devices and disabling LoRaWAN images", () => {
    const nodeTargets: DeviceNodeTarget[] = [
      { kind: "gateway_node", gateway_device_id: "gateway-a", node_index: 0 },
      { kind: "gateway_node", gateway_device_id: "gateway-a", node_index: 1 },
      { kind: "device", device_id: "standalone" },
    ];

    const payload = buildGroupExportPayload({
      nodeTargets, gateway, start, end, lorawan: true, images: true, data: true, status: false,
    });

    expect(payload).toEqual({
      resource_type: "device_batch",
      resource_id: "gateway-a",
      export_type: "group_site_zip",
      request_config: {
        device_ids: ["gateway-a", "standalone"],
        node_targets: nodeTargets,
        gateway_id: "gateway-a",
        gateway_name: "North station",
        start_time: start,
        end_time: end,
        include_data: true,
        include_images: false,
        include_status: false,
      },
    });
  });

  it("allows a gateway status export with no selected nodes", () => {
    const payload = buildGroupExportPayload({
      nodeTargets: [], gateway, start, end, lorawan: true, images: false, data: false, status: true,
    });

    expect(payload).toMatchObject({
      resource_type: "device_batch",
      resource_id: "gateway-a",
      export_type: "group_site_zip",
      request_config: {
        device_ids: ["gateway-a"],
        node_targets: [],
        gateway_id: "gateway-a",
        include_data: false,
        include_images: false,
        include_status: true,
      },
    });
  });

  it("keeps equal node indices on different gateways distinct and resolves saved names after devices change or disappear", () => {
    const result = resolveExportTargets({
      export_type: "group_site_zip",
      resource_type: "device_batch",
      resource_id: "gateway-a",
      request_config: {
        gateway_id: "gateway-a",
        gateway_name: "North station at export time",
        node_targets: [
          { kind: "gateway_node", gateway_device_id: "gateway-a", node_index: 0 },
          { kind: "gateway_node", gateway_device_id: "gateway-b", node_index: 0 },
          { kind: "device", device_id: "standalone" },
        ],
        node_names: {
          "gateway:gateway-a:node:0": "North probe",
          "gateway:gateway-b:node:0": "South probe",
          "device:standalone": "Removed probe at export time",
        },
      },
    }, [{ id: "gateway-a", name: "Renamed station", serial_no: "SN-001" }]);

    expect(result.station).toMatchObject({ key: "gateway-a", name: "North station at export time" });
    expect(result.items.map(({ key, name }) => ({ key, name }))).toEqual([
      { key: "gateway:gateway-a:node:0", name: "North probe" },
      { key: "gateway:gateway-b:node:0", name: "South probe" },
      { key: "standalone", name: "Removed probe at export time" },
    ]);
  });
});
