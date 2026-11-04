import { act } from "react";
import { expect, it, vi } from "vitest";
import { api, type DeviceMapItem, type GatewayNode, type DashboardOverview } from "@thcpn/api";
import { EcoDirectory } from "../../apps/platform/src/features/atlas/eco-directory";
import { render, eventually } from "../render";

const device = (device_id: string, device_type: string, extra: Partial<DeviceMapItem> = {}): DeviceMapItem => ({
  device_id, device_type, name: device_id, serial_no: `${device_id}-SN`, status: "active", location_source: "device", child_count: 0,
  environment: { research_tags: [], observation_objects: [], purposes: [] }, ...extra,
});
const gateway = device("gateway", "gateway");
const total = (value: number) => ({ value, complete: true, covered_devices: 2, total_devices: 2 });
const overview: DashboardOverview = {
  generated_at: "2026-11-03T06:00:00Z", statistics_updated_at: null, timezone: "Asia/Shanghai", days: 7, refresh_interval_seconds: 30,
  records: { total: total(900), today: total(24), first_observed_at: null }, images: { total: total(3), today: total(1) }, trend: [],
  devices: { total: 2, reporting: 1, delayed: 1, no_data: 0, unknown: 0, inactive: 0 }, attention: [], active_alerts: 0,
};
const node: GatewayNode = { key: "gateway:gateway:node:1", name: "林冠节点 01", custom_name: "", node_sn: "NODE-001", can_rename: false, streams: [], target: { kind: "gateway_node", gateway_device_id: "gateway", node_index: 1 } };

it("uses actual totals, avoids duplicate virtual counts and selects a gateway node", async () => {
  vi.spyOn(api, "dashboard").mockResolvedValue(overview);
  vi.spyOn(api.devices, "nodes").mockResolvedValue({ items: [node] });
  vi.spyOn(api.devices, "nodeRuntime").mockResolvedValue({ items: [{ key: node.key, sampled_at: new Date().toISOString(), rssi: -72 }], refreshed_at: new Date().toISOString() });
  const onSelectNode = vi.fn();
  const onKindChange = vi.fn();
  const { host } = await render(<EcoDirectory workspaceId="forest" devices={[gateway, device("virtual", "gateway_node", { gateway_device_id: "gateway", node_index: 1 }), device("station", "standalone")]} selectedDevice={gateway} selectedNodeKey="gateway" onSelect={vi.fn()} onSelectNode={onSelectNode} kind="network" onKindChange={onKindChange}/>);
  await eventually(() => expect(host.querySelector(".eco-node-status")?.textContent).toBe("已上报"));
  expect(host.querySelectorAll(".eco-overview-count strong")[2].textContent).toBe("24");
  expect(host.querySelectorAll(".eco-overview-count strong")[3].textContent).toBe("50.0%");
  expect(host.querySelector('.eco-distribution-bars [data-kind="network"] b')?.textContent).toBe("1");
  await act(async () => host.querySelector<HTMLButtonElement>(".eco-node-table button")!.click());
  expect(onSelectNode).toHaveBeenCalledWith(node.key);
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".eco-type-switch button")[1].click());
  expect(onKindChange).toHaveBeenCalledWith("all");
});

it("does not substitute workspace collection totals for a scoped screen", async () => {
  const dashboard = vi.spyOn(api, "dashboard").mockResolvedValue(overview);
  vi.spyOn(api.devices, "runtime").mockResolvedValue({ items: [], failures: [], refreshed_at: new Date().toISOString() });
  const { host } = await render(<EcoDirectory workspaceId="scoped" devices={[device("station", "standalone")]} selectedNodeKey="gateway" onSelect={vi.fn()} onSelectNode={vi.fn()} kind="standalone" onKindChange={vi.fn()} scoped/>);
  await eventually(() => expect(host.querySelectorAll(".eco-overview-count strong")[0].textContent).toBe("1"));
  expect(dashboard).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".eco-overview-count strong")[2].textContent).toBe("—");
  expect(host.querySelectorAll(".eco-overview-count strong")[1].textContent).toBe("—");
});
