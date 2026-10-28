// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@thcpn/api";
import { GatewayNodeCount } from "./gateway-node-count";

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const result = (status: "completed" | "partial") => ({ gateway: { sn: "GW", node_count: 3 }, status, write_state: { operation_id: "operation", source: "accepted", platform: status === "partial" ? "failed" : "synced", device: "unknown" }, warnings: [] });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.spyOn(api.admin, "deviceLoRaWANV2Context").mockResolvedValue({ data_source_id: "source", gateway_sn: "GW" });
  vi.spyOn(api.admin, "loraWANV2Gateway").mockResolvedValue({ sn: "GW", node_count: 2 });
  vi.spyOn(api.admin, "updateLoRaWANV2NodeCount").mockResolvedValue(result("completed"));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove(); client?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.replace(/\s/g, "") === text)!;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); }); }
async function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(<QueryClientProvider client={client}><App><GatewayNodeCount deviceId="gateway" /></App></QueryClientProvider>));
  await act(async () => button("增加节点").click());
  await settle();
}
it("reads the source count and submits the absolute total only after confirmation", async () => {
  await mount();
  expect(api.admin.loraWANV2Gateway).toHaveBeenCalledWith("source", "GW");
  expect(api.admin.updateLoRaWANV2NodeCount).not.toHaveBeenCalled();
  expect(document.querySelector(".ant-modal")?.textContent).toContain("将新增节点 3，共 1 个");
  await act(async () => button("确认增加节点").click()); await settle();
  expect(api.admin.updateLoRaWANV2NodeCount).toHaveBeenCalledWith("gateway", 3);
});
it("blocks expansion at the upstream limit even if the platform was stale", async () => {
  vi.mocked(api.admin.loraWANV2Gateway).mockResolvedValue({ sn: "GW", node_count: 254 });
  await mount();
  expect(button("确认增加节点").disabled).toBe(true);
  expect(document.querySelector(".ant-modal")?.textContent).toContain("已达到 254");
});
it("retries the same total after a platform-only failure", async () => {
  vi.mocked(api.admin.updateLoRaWANV2NodeCount).mockResolvedValueOnce(result("partial")).mockResolvedValue(result("completed"));
  await mount(); await act(async () => button("确认增加节点").click()); await settle();
  expect(document.querySelector(".ant-modal")?.textContent).toContain("平台尚未完成同步");
  await act(async () => button("重试平台同步").click()); await settle();
  expect(vi.mocked(api.admin.updateLoRaWANV2NodeCount).mock.calls).toEqual([["gateway", 3], ["gateway", 3]]);
});
it("readbacks an ambiguous response and offers reconciliation instead of another increment", async () => {
  vi.mocked(api.admin.loraWANV2Gateway).mockResolvedValueOnce({ sn: "GW", node_count: 2 }).mockResolvedValue({ sn: "GW", node_count: 3 });
  vi.mocked(api.admin.updateLoRaWANV2NodeCount).mockRejectedValueOnce(new Error("结果未知")).mockResolvedValue(result("completed"));
  await mount(); await act(async () => button("确认增加节点").click()); await settle();
  expect(button("重试平台同步").disabled).toBe(false);
  await act(async () => button("重试平台同步").click()); await settle();
  expect(vi.mocked(api.admin.updateLoRaWANV2NodeCount).mock.calls).toEqual([["gateway", 3], ["gateway", 3]]);
});
