import { act, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api, type DataStream, type DeviceMapItem } from "@thcpn/api";
import { I18nProvider } from "@thcpn/i18n";
import { AtlasDevice } from "../../apps/platform/src/features/atlas/atlas-device";
import { preferenceKey } from "../../apps/platform/src/features/atlas/atlas-metric-preferences";
import { render, eventually } from "../render";
vi.mock("@thcpn/auth", () => ({ useAuth: () => ({ user: { id: "observer" } }) }));
const stamp = "2026-11-03T00:00:00Z";
const metrics: DataStream[] = Array.from({ length: 7 }, (_, index) => ({ id: `stream${index}`, name: `指标${index}`, code: `metric${index}`, type: "telemetry", status: "active", device_id: "gateway", computed: false, created_by: "observer", created_at: stamp, updated_at: stamp }));
const device: DeviceMapItem = { device_id: "gateway", name: "青山组网站", serial_no: "GW001", device_type: "gateway", status: "active", location_source: "none", child_count: 1, environment: { observation_objects: [], purposes: [], research_tags: [] } };
function App() {
  const [node, setNode] = useState("gateway");
  const [version, setVersion] = useState(0);
  return <MemoryRouter><I18nProvider><button onClick={() => setVersion(version + 1)}>重新打开</button><button onClick={() => setNode(node === "gateway" ? "node1" : "gateway")}>切换节点</button><AtlasDevice key={version} workspaceId="forest" boardId="board" device={device} selectedNodeKey={node} config={{ trend_hours: 24, layout: "balanced", presentation: "deep-blue", metric_defaults: { "device:gateway": ["metric1", "metric3"] }, show_trends: false, show_images: false }} onSelection={() => {}} /></I18nProvider></MemoryRouter>;
}
function click(text: string, host: ParentNode = document) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(element => (element.textContent?.trim() === text || (text === "保存" && element.textContent?.trim() === "Save") || (text === "恢复类型默认" && element.textContent?.trim() === "Restore type defaults")));
  expect(button, text).toBeTruthy();
  return act(async () => button!.click());
}
function cardNames(host: HTMLElement) { return [...host.querySelectorAll(".atlas-metric-name > span:first-of-type")].map(element => element.textContent); }
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  localStorage.setItem("thcpn.locale", "zh-CN");
  vi.spyOn(api.dataStreams, "list").mockResolvedValue({ items: metrics });
  vi.spyOn(api.devices, "nodes").mockResolvedValue({ items: [{ key: "node1", name: "林冠节点01", custom_name: "", can_rename: false, target: { kind: "gateway_node", gateway_device_id: "gateway", node_index: 1 }, streams: [{ ...metrics[0], id: "node-stream", code: "metric1", name: "节点温度" }] }] });
  vi.spyOn(api.telemetry, "dataStream").mockResolvedValue({ device_id: "gateway", start_time: stamp, end_time: stamp, limit: 1, series: [] });
});
it("opens all metrics, limits six selections, reorders, saves, reloads and restores defaults", async () => {
  const { host } = await render(<App />);
  await eventually(() => expect(cardNames(host)).toEqual(["指标1", "指标3"]));
  await click("全部指标 · 7", host);
  const popup = document.querySelector<HTMLElement>(".atlas-metric-popover")!;
  await eventually(() => expect(popup).toBeTruthy());
  const checkboxes = [...popup.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  for (const index of [0, 2, 4, 5]) await act(async () => checkboxes[index].click());
  expect(checkboxes[6].disabled).toBe(true);
  const up = popup.querySelector<HTMLButtonElement>('[aria-label="上移指标3"]')!;
  await act(async () => up.click());
  const search = popup.querySelector<HTMLInputElement>('input[aria-label="搜索指标"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "指标5");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(popup.querySelectorAll(".atlas-metric-choice")).toHaveLength(1);
  await click("保存", popup);
  const key = preferenceKey("observer", "forest", "board", "gateway", "gateway");
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(["stream3", "stream1", "stream0", "stream2", "stream4", "stream5"]);
  await click("重新打开", host);
  await eventually(() => expect(cardNames(host)).toEqual(["指标3", "指标1", "指标0", "指标2", "指标4", "指标5"]));
  await click("全部指标 · 7", host);
  await click("恢复类型默认", document.querySelector(".atlas-metric-popover")!);
  expect(localStorage.getItem(key)).toBeNull();
  await eventually(() => expect(cardNames(host)).toEqual(["指标1", "指标3"]));
});
it("keeps node metrics separate and scopes personal selection to the chosen node", async () => {
  const { host } = await render(<App />);
  await eventually(() => expect(cardNames(host)).toEqual(["指标1", "指标3"]));
  await click("切换节点", host);
  await eventually(() => expect(cardNames(host)).toEqual(["节点温度"]));
  await click("全部指标 · 1", host);
  const popup = document.querySelector<HTMLElement>(".atlas-metric-popover")!;
  await act(async () => popup.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("保存", popup);
  expect(JSON.parse(localStorage.getItem(preferenceKey("observer", "forest", "board", "gateway", "node1"))!)).toEqual([]);
  await click("切换节点", host);
  await eventually(() => expect(cardNames(host)).toEqual(["指标1", "指标3"]));
  await click("切换节点", host);
  await eventually(() => expect(cardNames(host)).toEqual([]));
});
