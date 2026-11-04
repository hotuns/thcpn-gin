import { describe, expect, it } from "vitest";
import type { DeviceMapItem, GatewayNode } from "@thcpn/api";
import { networkArc, networkMarkerIds, networkNodes } from "../../apps/platform/src/features/atlas/atlas-network-model";

const node = (key: string, extra: Partial<GatewayNode> = {}): GatewayNode => ({
  key, name: key, custom_name: "", can_rename: false, streams: [],
  target: { kind: "gateway_node", gateway_device_id: "gateway", node_index: 1 }, ...extra,
});
const child = (id: string, extra: Partial<DeviceMapItem> = {}): DeviceMapItem => ({
  device_id: id, name: id, serial_no: id, device_type: "gateway_node", status: "active",
  location_source: "manual", child_count: 0, environment: { research_tags: [], observation_objects: [], purposes: [] }, ...extra,
});

describe("atlas network geography", () => {
  it("only places nodes at real coordinates, including zero coordinates", () => {
    const result = networkNodes([
      node("origin", { latitude: 0, longitude: 0 }), node("unset"),
      node("invalid", { latitude: 91, longitude: 10 }), node("infinite", { latitude: 10, longitude: Infinity }),
    ], []);
    expect(result.locatedNodes.map(item => item.node.key)).toEqual(["origin"]);
    expect(result.unlocated).toBe(3);
  });
  it("resolves legacy child coordinates by device identity, preferring explicit node coordinates", () => {
    const result = networkNodes([
      node("legacy", { target: { kind: "device", device_id: "child" } }),
      node("explicit", { target: { kind: "device", device_id: "child" }, longitude: 110, latitude: 20 }),
      node("missing", { target: { kind: "device", device_id: "other" } }),
    ], [child("child", { longitude: 120, latitude: 30 })]);
    expect(result.locatedNodes.map(item => item.location)).toEqual([{ longitude: 120, latitude: 30 }, { longitude: 110, latitude: 20 }]);
    expect(result.unlocated).toBe(1);
  });
  it("anchors an elevated arc exactly at node and gateway screen points", () => {
    expect(networkArc({ x: 20, y: 100 }, { x: 220, y: 100 })).toBe("M 20 100 Q 120 36 220 100");
    expect(networkArc({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe("M 10 20 Q 10 20 10 20");
  });
});


it("suppresses native markers for the same located V1 and V2 nodes, preserving unrelated and globe markers", () => {
  const devices = [
    child("legacy"),
    child("synthetic", { gateway_device_id: "gateway", node_index: 1 }),
    child("other-gateway", { gateway_device_id: "different", node_index: 1 }),
    child("other-node", { gateway_device_id: "gateway", node_index: 2 }),
  ];
  const nodes = networkNodes([
    node("v1", { target: { kind: "device", device_id: "legacy" }, longitude: 110, latitude: 20 }),
    node("v2", { longitude: 111, latitude: 21 }),
  ], devices).locatedNodes;
  expect([...networkMarkerIds(nodes, devices)]).toEqual(["legacy", "synthetic"]);
  expect([...networkMarkerIds([], devices)]).toEqual([]);
});
