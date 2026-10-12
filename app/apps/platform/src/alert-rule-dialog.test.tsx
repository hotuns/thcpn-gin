// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { api, type Device } from "@thcpn/api";
import { CreateRuleDialog } from "./alerts-page";

let root: Root;
let container: HTMLDivElement;
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
const button = (name: string) => [...document.querySelectorAll("button")].find(el => el.textContent === name)!;
const click = async (el: HTMLElement) => { await act(async () => el.click()); };

it("creates an offline rule through the three steps with a named recipient and no threshold payload", async () => {
  vi.spyOn(api.devices, "list").mockResolvedValue({ items: [{ id: "device", name: "Test device" } as Device] });
  vi.spyOn(api.members, "list").mockResolvedValue({ items: [{ status: "active", user: { id: "user", name: "Recipient", email: "test@example.com" } }] });
  const create = vi.spyOn(api.alerts, "createRule").mockResolvedValue({} as Awaited<ReturnType<typeof api.alerts.createRule>>);
  const saved = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(<QueryClientProvider client={client}><CreateRuleDialog open workspaceId="workspace" initialDeviceId="device" onClose={vi.fn()} onSaved={saved}/></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  await click([...document.querySelectorAll("button")].find(el => el.textContent?.startsWith("设备离线"))!);
  await click(button("下一步"));
  expect(document.querySelector('[aria-label="无数据时长（分钟）"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="严重级别"]')).not.toBeNull();
  await click(button("下一步"));
  expect(button("创建并启用").disabled).toBe(true);
  await click(document.querySelector('[role="checkbox"]')!);
  await click(button("创建并启用"));
  expect(create).toHaveBeenCalledWith("workspace", expect.objectContaining({ type: "device_offline", offline_after_seconds: 1800, recipient_user_ids: ["user"], channels: ["in_app"], condition: undefined }));
  expect(saved).toHaveBeenCalledOnce();
});
