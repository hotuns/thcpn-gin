import { act, useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api, type AtlasView, type DeviceMapItem } from "@thcpn/api";
import { AtlasPage } from "../../apps/platform/src/features/atlas/atlas-page";
import { atlasZh } from "../../packages/i18n/src/atlas";
import { render, eventually } from "../render";
import type { AtlasScreenProps } from "../../apps/platform/src/features/atlas/atlas-screen-props";

vi.mock("@thcpn/workspace", () => ({
  useWorkspace: () => ({ currentId: "forest", current: { name: "森林工作区" } }),
  workspaceQueryKey: (id: string, ...parts: string[]) => ["workspace", id, ...parts],
}));
vi.mock("@thcpn/i18n", () => ({ useLocale: () => ({ locale: "zh-CN", t: (key: string) => key.startsWith("atlas.") ? atlasZh[key.slice(6) as keyof typeof atlasZh] ?? key : key }) }));
vi.mock("../../apps/platform/src/shared/observatory/observatory-decoration", () => ({
  ObservatoryMasthead: () => null, ObservatoryPanelFrame: () => null,
  ObservatoryTitle: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("../../apps/platform/src/features/atlas/atlas-health", async importOriginal => ({ ...await importOriginal<typeof import("../../apps/platform/src/features/atlas/atlas-health")>(), AtlasHealth: () => null }));
vi.mock("../../apps/platform/src/features/atlas/atlas-map", () => ({ AtlasMap: ({ points, onSelect, appearance }: { points: DeviceMapItem[]; onSelect: (id: string) => void; appearance?: string }) => <div data-testid="map" data-appearance={appearance}>{points.map(point => <button type="button" className="map-marker" key={point.device_id} onClick={() => onSelect(point.device_id)}>{point.name}</button>)}</div> }));
vi.mock("../../apps/platform/src/shared/data/device-combobox", () => ({ DeviceCombobox: () => null }));
vi.mock("../../apps/platform/src/features/atlas/atlas-metric-settings", () => ({ AtlasMetricDefaultsEditor: () => null }));
vi.mock("../../apps/platform/src/shared/config/system-policy", () => ({ usePolicyLimit: (_key: string, fallback: number) => fallback }));
vi.mock("../../apps/platform/src/features/atlas/atlas-device", () => ({
  AtlasEmpty: ({ text }: { text: string }) => <p>{text}</p>, AtlasError: () => <p role="alert">请求失败</p>,
  AtlasDevice: ({ device, selectedNodeKey }: { device: DeviceMapItem; selectedNodeKey?: string }) => { const [count, setCount] = useState(0); return <button data-testid="inspector" data-device-id={device.device_id} data-node-key={selectedNodeKey} onClick={() => setCount(count + 1)}>{device.name} · {count}</button>; },
}));
vi.mock("../../apps/platform/src/features/atlas/eco-device", () => ({
  EcoDeviceInspector: ({ device, selectedNodeKey }: { device: DeviceMapItem; selectedNodeKey?: string }) => { const [count, setCount] = useState(0); return <button data-testid="inspector" data-device-id={device.device_id} data-node-key={selectedNodeKey} onClick={() => setCount(count + 1)}>{device.name} · {count}</button>; },
}));
vi.mock("../../apps/platform/src/features/atlas/research-screen", () => ({
  ResearchScreen: ({ title, map, settings }: AtlasScreenProps) => <section className="research-screen"><h1>{title}</h1>{map}{settings}</section>,
}));
vi.mock("../../apps/platform/src/features/atlas/expedition-screen", () => ({
  ExpeditionScreen: ({ title, map, settings }: AtlasScreenProps) => <section className="expedition-screen"><h1>{title}</h1>{map}{settings}</section>,
}));
const stamp = "2026-11-03T06:00:00Z";
function view(id: string, name: string, presentation: "deep-blue" | "technology" | "panorama" = "deep-blue"): AtlasView {
  return { id, name, workspace_id: "forest", template_code: "atlas-tech", template_version: 1, template_name: "Atlas", component_key: "atlas", status: "active", created_by: "observer", created_at: stamp, updated_at: stamp, config: { presentation, trend_hours: 24, layout: "balanced", show_images: true, show_trends: true } };
}
const devices: DeviceMapItem[] = ["standalone", "gateway", "gateway_node", "carbon_sink", "camera"].map((role, index) => ({ device_id: `device-${index}`, serial_no: `SN-${index}`, name: `${role}设备`, device_type: role, status: "active", location_source: "device", child_count: 0, latitude: 30 + index / 10, longitude: 110, environment: { observation_objects: [], purposes: [], research_tags: [] } }));
let views: AtlasView[];
let canManage: boolean;
function Location() { return <output data-testid="route">{useLocation().pathname}</output>; }
function visibleButtons(scope: ParentNode = document) { return Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).filter(button => !button.closest("[hidden]")); }
function button(text: string, scope: ParentNode = document) { const found = visibleButtons(scope).find(item => item.textContent === text || item.getAttribute("aria-label") === text); expect(found, `button ${text}`).toBeTruthy(); return found!; }
async function click(text: string, scope: ParentNode = document) { await act(async () => button(text, scope).click()); }
async function input(element: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function mount(path = "/atlas") { return render(<MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/atlas" element={<AtlasPage />} /><Route path="/atlas/:id" element={<AtlasPage />} /><Route path="/atlas/topics/digital-plot" element={<h1>数字样地专题</h1>} /></Routes></MemoryRouter>); }

beforeEach(() => {
  views = [view("blue", "青山观测"), view("command", "湿地观测", "technology")]; canManage = true;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const count = { value: 0, complete: true, covered_devices: 0, total_devices: 5 };
  vi.spyOn(api, "dashboard").mockResolvedValue({ generated_at: stamp, statistics_updated_at: stamp, timezone: "Asia/Shanghai", days: 7, refresh_interval_seconds: 30, records: { total: count, today: count, first_observed_at: stamp }, images: { total: count, today: count }, trend: [], devices: { total: 5, reporting: 0, delayed: 0, no_data: 5, unknown: 0, inactive: 0 }, attention: [], active_alerts: 0 });
  vi.spyOn(api.devices, "nodes").mockResolvedValue({ items: [] });
  vi.spyOn(api.atlas, "list").mockImplementation(async () => ({ items: views, total: views.length, can_manage: canManage }));
  vi.spyOn(api.atlas, "get").mockImplementation(async (_workspace, id) => views.find(item => item.id === id)!);
  vi.spyOn(api.devices, "map").mockResolvedValue({ items: devices, total: devices.length, located: devices.length, unlocated: 0, unclassified: 0 });
});

it("separates saved atlases, registered templates and curated topics, and searches saved views", async () => {
  const { host } = await mount();
  await eventually(() => expect(host.querySelectorAll(".atlas-saved-card")).toHaveLength(2));
  expect(host.querySelector('[aria-labelledby="atlas-saved-title"]')?.hasAttribute("hidden")).toBe(false);
  await input(host.querySelector<HTMLInputElement>('[aria-label="搜索名称或简介"]')!, "青山");
  expect(host.querySelectorAll(".atlas-saved-card")).toHaveLength(1);
  expect(host.querySelector(".atlas-saved-card")?.textContent).toContain("青山观测");
  await click("模板3", host);
  expect(host.querySelector(".atlas-home-templates")?.closest("[hidden]")).toBeNull();
  expect(host.querySelectorAll(".atlas-home-template")).toHaveLength(3);
  expect(host.querySelector(".atlas-home-template")?.textContent).toContain("深蓝科技");
  await click("专题1", host);
  expect(host.querySelector(".atlas-custom-showcase")?.closest("[hidden]")).toBeNull();
  expect(host.querySelector(".atlas-home-templates")?.closest("[hidden]")).not.toBeNull();
});

it("creates a deep-blue atlas through the save API and opens that same saved view", async () => {
  const create = vi.spyOn(api.atlas, "create").mockImplementation(async (_workspace, payload) => { const result = { ...view("created", payload.name), config: payload.config }; views.push(result); return result; });
  const { host } = await mount();
  await eventually(() => expect(api.devices.map).toHaveBeenCalled());
  await click("新建一张图", host);
  await click("使用模板并自定义 · 深蓝科技", host);
  await eventually(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  await click("保存视图", document.querySelector('[role="dialog"]')!);
  await eventually(() => expect(host.querySelector('[data-testid="route"]')?.textContent).toBe("/atlas/created"));
  expect(create).toHaveBeenCalledWith("forest", expect.objectContaining({ template_code: "atlas-tech", config: expect.objectContaining({ presentation: "deep-blue" }) }));
  expect(host.querySelector(".eco-screen")).not.toBeNull();
  expect(host.querySelector(".atlas-shell, .atlas-template-deep-blue, .obs-masthead")).toBeNull();
  expect(host.querySelector('[data-testid="map"]')?.getAttribute("data-appearance")).toBe("deep-blue");
});

it("hides management actions for viewers and does not fetch management-only device catalogs", async () => {
  canManage = false;
  const { host } = await mount();
  await eventually(() => expect(host.querySelectorAll(".atlas-saved-card")).toHaveLength(2));
  expect(visibleButtons(host).some(item => ["新建一张图", "自定义", "删除视图", "另存为"].includes(item.textContent ?? ""))).toBe(false);
  expect(api.devices.map).not.toHaveBeenCalled();
  await click("打开视图", host);
  await eventually(() => expect(host.querySelector(".eco-screen")).not.toBeNull());
  expect(visibleButtons(host).some(item => item.textContent === "编辑大屏")).toBe(false);
});

it("filters by topology category and preserves inspector state after editing in place", async () => {
  const update = vi.spyOn(api.atlas, "update").mockImplementation(async (_workspace, id, payload) => { const updated = { ...views.find(item => item.id === id)!, ...payload }; views = views.map(item => item.id === id ? updated : item); return updated; });
  const { host } = await mount("/atlas/blue");
  await eventually(() => expect(host.querySelectorAll('[aria-label="选择观测设备"] option')).toHaveLength(5));
  await click("组网站", host);
  expect(host.querySelectorAll('[aria-label="选择观测设备"] option')).toHaveLength(2);
  expect(Array.from(host.querySelectorAll('[aria-label="选择观测设备"] option')).every(item => item.textContent?.includes("gateway"))).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inspector"]')!.click());
  expect(host.querySelector('[data-testid="inspector"]')?.textContent).toContain("· 1");
  await click("编辑大屏", host);
  await eventually(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  const nameInput = Array.from(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')).find(item => item.value === "青山观测")!;
  await input(nameInput, "青山生态观测");
  await click("保存视图", document.querySelector('[role="dialog"]')!);
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(update).toHaveBeenCalledWith("forest", "blue", expect.objectContaining({ name: "青山生态观测" }));
  expect(host.querySelector('[data-testid="route"]')?.textContent).toBe("/atlas/blue");
  expect(host.querySelector('[data-testid="inspector"]')?.textContent).toContain("· 1");
  expect(host.querySelectorAll('[aria-label="选择观测设备"] option')).toHaveLength(2);
});

it("copies an atlas as a new record without exposing delete for the unsaved copy", async () => {
  const create = vi.spyOn(api.atlas, "create").mockImplementation(async (_workspace, payload) => ({ ...view("copy", payload.name), config: payload.config }));
  const update = vi.spyOn(api.atlas, "update");
  const { host } = await mount();
  await eventually(() => expect(host.querySelectorAll(".atlas-saved-card")).toHaveLength(2));
  await click("另存为", host.querySelector(".atlas-saved-card")!);
  await eventually(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  expect(visibleButtons(document.querySelector('[role="dialog"]')!).some(item => item.textContent === "删除视图")).toBe(false);
  await click("保存视图", document.querySelector('[role="dialog"]')!);
  await eventually(() => expect(create).toHaveBeenCalled());
  expect(update).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledWith("forest", expect.objectContaining({ config: expect.objectContaining({ presentation: "deep-blue" }) }));
});

it("archives the selected view only after confirming, then refreshes the saved list", async () => {
  const archive = vi.spyOn(api.atlas, "archive").mockImplementation(async (_workspace, id) => { views = views.filter(item => item.id !== id); });
  const { host } = await mount();
  await eventually(() => expect(host.querySelectorAll(".atlas-saved-card")).toHaveLength(2));
  await click("删除视图", host.querySelector(".atlas-saved-card")!);
  expect(archive).not.toHaveBeenCalled();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  await click("删除视图", document.querySelector('[role="dialog"]')!);
  await eventually(() => expect(host.querySelectorAll(".atlas-saved-card")).toHaveLength(1));
  expect(archive).toHaveBeenCalledWith("forest", "blue");
  expect(host.querySelector(".atlas-saved-card")?.textContent).toContain("湿地观测");
});

it("resolves a virtual map node through its real gateway before opening its inspector", async () => {
  const virtual = { ...devices[2], device_id: "gateway:device-1:node:3", name: "虚拟节点 3", gateway_device_id: "device-1", node_index: 3 };
  vi.mocked(api.devices.map).mockResolvedValue({ items: [...devices, virtual], total: 6, located: 6, unlocated: 0, unclassified: 0 });
  const { host } = await mount("/atlas/blue");
  await eventually(() => expect(host.querySelectorAll(".map-marker")).toHaveLength(6));
  const row = Array.from(host.querySelectorAll<HTMLButtonElement>(".map-marker")).find(item => item.textContent?.includes("虚拟节点 3"))!;
  await act(async () => row.click());
  expect(host.querySelector('[data-testid="inspector"]')?.getAttribute("data-device-id")).toBe("device-1");
  expect(host.querySelector('[data-testid="inspector"]')?.getAttribute("data-node-key")).toBe("gateway:device-1:node:3");
});


it.each([
  ["technology", "research-screen", "research"],
  ["panorama", "expedition-screen", "expedition"],
  ["deep-blue", "eco-screen", "deep-blue"],
] as const)("opens the saved %s template with its own layout and map appearance", async (presentation, rootClass, appearance) => {
  views = [view("selected", "独立模板观测", presentation)];
  const { host } = await mount("/atlas/selected");
  await eventually(() => expect(host.querySelector('[data-testid="map"]')).not.toBeNull());
  expect(host.querySelector(`.${rootClass}`)).not.toBeNull();
  expect(host.querySelector('[data-testid="map"]')?.getAttribute("data-appearance")).toBe(appearance);
  expect(host.querySelectorAll(".research-screen, .expedition-screen, .eco-screen")).toHaveLength(1);
  expect(host.querySelector(".atlas-shell, .atlas-template-technology, .atlas-template-panorama, .atlas-template-deep-blue, .obs-masthead")).toBeNull();
  expect(host.querySelector('[data-testid="route"]')?.textContent).toBe("/atlas/selected");
  expect(host.querySelector("h1")?.textContent).toBe("独立模板观测");
});
