import type { DeviceMapItem, GatewayNode } from "@thcpn/api";
import { located } from "./atlas-model";

export type NetworkLocation = { longitude: number; latitude: number };
export type LocatedNetworkNode = { node: GatewayNode; location: NetworkLocation };

/** A child device's real coordinates may supply a V1 node location. */
export function networkNodes(nodes: GatewayNode[], devices: DeviceMapItem[]) {
  const locatedNodes: LocatedNetworkNode[] = [];
  for (const node of nodes) {
    const child = node.target.kind === "device"
      ? devices.find(device => node.target.kind === "device" && device.device_id === node.target.device_id)
      : undefined;
    const location = located(node) ? node : child && located(child) ? child : undefined;
    if (location) locatedNodes.push({ node, location: { longitude: location.longitude!, latitude: location.latitude! } });
  }
  return { locatedNodes, unlocated: nodes.length - locatedNodes.length };
}

/** The path always starts at the real node and ends at the gateway's ground point. */
export function networkArc(start: { x: number; y: number }, end: { x: number; y: number }) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const lift = Math.min(160, length * .32);
  return `M ${start.x} ${start.y} Q ${(start.x + end.x) / 2} ${(start.y + end.y) / 2 - lift} ${end.x} ${end.y}`;
}

/** Native device-map rows include V1 devices and V2 synthetic node identities. */
export function networkMarkerIds(nodes: LocatedNetworkNode[], devices: DeviceMapItem[]) {
  const ids = new Set<string>();
  for (const { node } of nodes) {
    const target = node.target;
    if (target.kind === "device") ids.add(target.device_id);
    else for (const device of devices) {
      if (device.gateway_device_id === target.gateway_device_id && device.node_index === target.node_index) ids.add(device.device_id);
    }
  }
  return ids;
}
