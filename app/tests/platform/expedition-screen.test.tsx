import { act } from "react";
import { expect, it, vi } from "vitest";
import { api, type DataStream, type DeviceMapItem } from "@thcpn/api";
import { ExpeditionScreen } from "../../apps/platform/src/features/atlas/expedition-screen";
import type { AtlasScreenProps } from "../../apps/platform/src/features/atlas/atlas-screen-props";
import { render, eventually } from "../render";

vi.mock("@thcpn/auth", () => ({ useAuth: () => ({ user: { id: "observer" } }) }));
const stamp = "2026-11-03T00:00:00Z";
const metrics: DataStream[] = Array.from({ length: 6 }, (_, index) => ({ id: `stream${index}`, name: `指标${index}`, unit: index === 0 ? "°C" : "%", code: `metric${index}`, type: "telemetry", status: "active", device_id: "station", computed: false, created_by: "observer", created_at: stamp, updated_at: stamp }));
const device: DeviceMapItem = { device_id: "station", name: "青山标准站", serial_no: "ST001", device_type: "standalone", status: "active", location_source: "device", latitude: -30, longitude: -110, child_count: 0, environment: { observation_objects: [], purposes: [], research_tags: [] } };
function props(): AtlasScreenProps {
  return {
    title: "生态观测一张图", workspaceId: "forest", boardId: "expedition", config: { trend_hours: 24, presentation: "panorama", layout: "balanced", device_ids: [device.device_id], metric_defaults: { "device:standalone": metrics.map(stream => stream.code) }, show_trends: true, show_images: false },
    devices: [device], selectedDevice: device, selectedNodeKey: "gateway", kind: "all", onKindChange: vi.fn(), onSelect: vi.fn(), onSelectNode: vi.fn(), map: <div data-testid="map"/>, canManage: true, onEdit: vi.fn(), onBack: vi.fn(), presenting: false, onFullscreen: vi.fn(), motion: { enabled: false, paused: true, reduced: false, toggle: vi.fn() },
  };
}

it("pages every selected observation through one wide chart without borrowing the blue layout", async () => {
  vi.spyOn(api.dataStreams, "list").mockResolvedValue({ items: metrics });
  vi.spyOn(api.telemetry, "dataStream").mockResolvedValue({ device_id: device.device_id, start_time: stamp, end_time: stamp, limit: 1, series: [] });
  const { host } = await render(<ExpeditionScreen {...props()}/>);
  await eventually(() => expect(host.querySelectorAll(".expedition-reading-list > button")).toHaveLength(6));
  await eventually(() => expect(api.telemetry.dataStream).toHaveBeenCalledTimes(6));
  expect(host.querySelectorAll(".expedition-chart")).toHaveLength(1);
  const plot = host.querySelector(".expedition-chart");
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".expedition-reading-list > button")[5].click());
  expect(host.querySelector(".expedition-chart-pagination > span")?.textContent).toBe("6 / 6");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="下一指标"]')?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="上一指标"]')!.click());
  expect(host.querySelector(".expedition-chart-pagination > span")?.textContent).toBe("5 / 6");
  expect(host.querySelector(".expedition-chart")).toBe(plot);
  expect(host.querySelector(".eco-inspector, .atlas-shell, .eco-screen")).toBeNull();
  expect(host.querySelector(".expedition-location-details")?.textContent).toContain("30.00000° S / 110.00000° W");
});

it("keeps device type, fullscreen, back and edit actions connected to the shared workspace", async () => {
  vi.spyOn(api.dataStreams, "list").mockResolvedValue({ items: [] });
  const options = props();
  const { host } = await render(<ExpeditionScreen {...options}/>);
  const click = async (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
  await click('.expedition-categories button:nth-child(2)');
  expect(options.onKindChange).toHaveBeenCalledWith("network");
  await click('[aria-label="全屏"]'); expect(options.onFullscreen).toHaveBeenCalled();
  await click('[aria-label="返回一张图管理"]'); expect(options.onBack).toHaveBeenCalled();
  await click('[aria-label="编辑大屏"]'); expect(options.onEdit).toHaveBeenCalled();
});
