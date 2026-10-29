// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { api } from "@thcpn/api";
import { LoRaWANV2LogsPanel } from "./lorawan-v2-logs-panel";

it("opens the resolved source URL instead of navigating to an object key inside the admin app", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
  vi.spyOn(api.admin, "deviceLoRaWANV2GatewayLogs").mockResolvedValue({ payload: { data: [{ file: "lorawan/v2/gateway/2026/10/29/log.txt", file_url: "https://source.example/lorawan/v2/gateway/2026/10/29/log.txt" }, { file: "lorawan/v2/gateway/missing.txt" }], pagination: { total: 2 } } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><LoRaWANV2LogsPanel deviceId="gateway" deviceName="Gateway" /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    const links = [...host.querySelectorAll("a[target=\"_blank\"]")];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://source.example/lorawan/v2/gateway/2026/10/29/log.txt");
  } finally {
    await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
