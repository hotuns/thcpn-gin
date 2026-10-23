// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type Device } from "@thcpn/api";
import { DevicesPage } from "./devices-page";

vi.mock("@thcpn/auth", () => ({ useAuth: () => ({ user: { is_demo: true } }) }));
vi.mock("@thcpn/workspace", () => ({
  useWorkspace: () => ({ currentId: "workspace" }),
  workspaceQueryKey: (id: string, ...parts: string[]) => ["workspace", id, ...parts],
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const devices: Device[] = (["standalone", "camera"] as const).map((type) => ({
  id: type,
  name: type === "camera" ? "测试相机" : "测试标准站",
  serial_no: type,
  device_type: type,
  topology_role: type,
  status: "active",
  lifecycle_status: "online",
  child_count: 0,
  capabilities: [],
  created_at: "",
  updated_at: "",
}));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const trigger = (label: string) => host.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)!;

async function choose(label: string, option: string) {
  await act(async () => {
    trigger(label).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent === option);
  expect(item).toBeDefined();
  await act(async () => item!.click());
  await settle();
}

beforeEach(async () => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(api.projects, "list").mockResolvedValue({ items: [{ id: "project-a", name: "项目甲" }, { id: "project-b", name: "项目乙" }] });
  vi.spyOn(api.sites, "list").mockResolvedValue({ items: [{ id: "site-a", name: "站点甲" }] });
  vi.spyOn(api.devices, "list").mockResolvedValue({ items: devices });
  vi.spyOn(api.devices, "map").mockResolvedValue({ items: [], total: 0, located: 0, unlocated: 0, unclassified: 0 });
  vi.spyOn(api.devices, "taxonomy").mockResolvedValue({ items: [{ id: "forest", kind: "ecosystem", code: "forest", name_zh: "森林", name_en: "Forest", status: "active", sort_order: 0, system_defined: true }] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><DevicesPage /></MemoryRouter></QueryClientProvider>));
  await settle();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  client?.clear();
  vi.restoreAllMocks();
});

it("allows selecting every all option and resets the site when the project changes", async () => {
  await choose("筛选项目", "项目甲");
  await choose("筛选站点", "站点甲");
  expect(api.devices.list).toHaveBeenLastCalledWith("workspace", { projectId: "project-a", siteId: "site-a" });
  await choose("筛选项目", "项目乙");
  expect(trigger("筛选站点").textContent).toContain("全部站点");
  expect(api.devices.list).toHaveBeenLastCalledWith("workspace", { projectId: "project-b", siteId: undefined });
  await choose("筛选项目", "全部项目");
  await choose("筛选站点", "站点甲");
  await choose("筛选站点", "全部站点");
  expect(trigger("筛选项目").textContent).toContain("全部项目");
  expect(trigger("筛选站点").textContent).toContain("全部站点");
  await choose("筛选设备类型", "森林");
  expect(host.textContent).toContain("没有匹配的设备");
  await choose("筛选设备类型", "全部设备类型");
  expect(host.textContent).toContain("测试标准站");
  expect(host.querySelector(".device-filter-reset")).toBeNull();
  await choose("筛选项目", "项目甲");
  await choose("筛选站点", "站点甲");
  await choose("筛选设备类型", "森林");
  await act(async () => host.querySelector<HTMLButtonElement>(".device-filter-reset")!.click());
  await settle();
  expect(trigger("筛选项目").textContent).toContain("全部项目");
  expect(trigger("筛选站点").textContent).toContain("全部站点");
  expect(trigger("筛选设备类型").textContent).toContain("全部设备类型");
  expect(host.textContent).toContain("测试标准站");
});

it("preserves category counts and supports arrow, End, and Home tab navigation", async () => {
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("设备分类");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["全部2", "标准站1", "组网站0", "碳汇站0", "监控站1"]);
  await act(async () => {
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  await settle();
  expect(document.activeElement).toBe(tabs[1]);
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain("测试标准站");
  expect(host.querySelector('[role="tabpanel"]')?.textContent).not.toContain("测试相机");
  await act(async () => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  await settle();
  expect(tabs[4].getAttribute("aria-selected")).toBe("true");
  const panel = host.querySelector('[role="tabpanel"]')!;
  expect(panel.id).toBe(tabs[4].getAttribute("aria-controls"));
  expect(panel.getAttribute("aria-labelledby")).toBe(tabs[4].id);
  expect(panel.textContent).toContain("测试相机");
  await act(async () => tabs[4].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  await settle();
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain("测试标准站");
  expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain("测试相机");
});
