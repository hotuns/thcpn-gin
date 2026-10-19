// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@thcpn/api";
import { ConfigCopyPicker, type ConfigCopyPreview } from "./config-copy-picker";

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const target = { id: "target", name: "目标设备", serial_no: "T-1", source_family: "carbon", device_type: "carbon_sink", product_id: "v2" };
const sourceA = { ...target, id: "source-a", name: "来源 A", serial_no: "A-1" };
const sourceB = { ...target, id: "source-b", name: "来源 B", serial_no: "B-1" };
const preview = (draft: string): ConfigCopyPreview<string> => ({ draft, summary: `配置 ${draft}`, preview: draft });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computedStyle(element));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.spyOn(api.admin, "devices").mockResolvedValue({ items: [target, sourceA, sourceB, { ...sourceA, id: "wrong-family", name: "LoRa 网关", source_family: "lorawan_v2" }] });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(read = vi.fn().mockResolvedValue(preview("A")), onCopy = vi.fn(), contexts?: { current: string; load: (id: string) => Promise<{ value: string; label: string }[]> }) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><ConfigCopyPicker targetDeviceId="target" configKind="测试配置" read={read} onCopy={onCopy} contexts={contexts} /></QueryClientProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await settle();
  return { read, onCopy };
}
async function choose(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find(item => item.textContent?.includes(value));
  expect(option).toBeDefined();
  await act(async () => option!.click());
  await settle();
}
const confirm = () => document.querySelector<HTMLButtonElement>(".ant-modal-footer .ant-btn-primary")!;

it("previews only compatible sources and requires explicit copy without any save request", async () => {
  const save = vi.spyOn(api.admin, "updateDeviceConfig");
  const { read, onCopy } = await mount();
  expect(confirm().disabled).toBe(true);
  await choose("配置来源设备", "来源 A");
  expect(document.querySelector(".ant-modal")?.textContent).toContain("配置 A");
  expect(document.querySelector(".ant-modal")?.textContent).toContain("目标设备");
  expect(read).toHaveBeenCalledWith(sourceA, target, undefined);
  expect(onCopy).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  expect(document.querySelector(".ant-select-dropdown")?.textContent).not.toContain("LoRa 网关");
  await act(async () => confirm().click());
  expect(onCopy).toHaveBeenCalledExactlyOnceWith("A");
  expect(host.textContent).toContain("草稿已载入：来源 A"); expect(save).not.toHaveBeenCalled();
});

it("does not replace the draft when the source read fails", async () => {
  const { onCopy } = await mount(vi.fn().mockRejectedValue(new Error("source unavailable")));
  await choose("配置来源设备", "来源 A");
  expect(confirm().disabled).toBe(true);
  expect(document.querySelector(".ant-alert-error")?.textContent).toContain("source unavailable");
  expect(onCopy).not.toHaveBeenCalled();
});

it("ignores a late response from a previous selection", async () => {
  let resolveA!: (value: ConfigCopyPreview<string>) => void;
  const pendingA = new Promise<ConfigCopyPreview<string>>(resolve => { resolveA = resolve; });
  const read = vi.fn().mockImplementation(source => source.id === "source-a" ? pendingA : Promise.resolve(preview("B")));
  const { onCopy } = await mount(read);
  await choose("配置来源设备", "来源 A");
  expect(confirm().disabled).toBe(true);
  await choose("配置来源设备", "来源 B");
  await act(async () => resolveA(preview("STALE-A"))); await settle();
  expect(document.querySelector(".ant-modal")?.textContent).toContain("配置 B");
  await act(async () => confirm().click());
  expect(onCopy).toHaveBeenCalledExactlyOnceWith("B");
});

it("cancels an in-flight copy without changing the current draft", async () => {
  let resolve!: (value: ConfigCopyPreview<string>) => void;
  const read = vi.fn().mockReturnValue(new Promise<ConfigCopyPreview<string>>(done => { resolve = done; }));
  const { onCopy } = await mount(read);
  await choose("配置来源设备", "来源 A");
  const cancel = [...document.querySelectorAll<HTMLButtonElement>(".ant-modal-footer button")].find(button => button.textContent?.replace(/\s/g, "") === "取消")!;
  await act(async () => cancel.click());
  await act(async () => resolve(preview("late"))); await settle();
  expect(onCopy).not.toHaveBeenCalled();
});

it("allows another node of the same gateway while excluding the current node", async () => {
  const contexts = { current: "1", load: vi.fn().mockResolvedValue([{ value: "1", label: "当前节点" }, { value: "2", label: "节点二" }]) };
  const { read, onCopy } = await mount(undefined, undefined, contexts);
  await choose("配置来源设备", "目标设备");
  expect(read).not.toHaveBeenCalled();
  await choose("配置来源节点", "节点二");
  expect(read).toHaveBeenCalledWith(target, target, "2");
  expect(document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")?.textContent ?? "").not.toContain("当前节点");
  await act(async () => confirm().click());
  expect(onCopy).toHaveBeenCalledWith("A");
});
