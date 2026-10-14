// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api, type GatewayNode } from "@thcpn/api";
import { NodeLocationEditor } from "./node-location-editor";

let root: Root;
let host: HTMLDivElement;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function mount(latitude = 30, longitude = 120) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const node: GatewayNode = { key: "gateway:gw:node:3", name: "节点 3", custom_name: "", can_rename: true, target: { kind: "gateway_node", gateway_device_id: "gw", node_index: 3 }, streams: [], latitude, longitude };
  await act(async () => root.render(<QueryClientProvider client={client}><NodeLocationEditor gatewayId="gw" node={node}/></QueryClientProvider>));
  await act(async () => host.querySelector("button")!.click());
  return invalidate;
}
it("saves paired coordinates to the selected node and refreshes nodes/maps", async () => {
  const write = vi.spyOn(api.devices, "updateNodeLocation").mockResolvedValue({});
  const invalidate = await mount(0, 0);
  await act(async () => document.querySelector<HTMLFormElement>('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(write).toHaveBeenCalledWith("gw", 3, { latitude: 0, longitude: 0 });
  expect(invalidate).toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("clears both coordinates without affecting node configuration", async () => {
  const write = vi.spyOn(api.devices, "updateNodeLocation").mockResolvedValue({});
  await mount();
  const clear = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => /清空位置|Clear location/.test(button.textContent ?? ""))!;
  await act(async () => clear.click());
  expect(write).toHaveBeenCalledWith("gw", 3, { latitude: null, longitude: null });
});
it("shows save errors and leaves the editor open", async () => {
  vi.spyOn(api.devices, "updateNodeLocation").mockRejectedValue(new Error("save failed"));
  await mount();
  await act(async () => document.querySelector<HTMLFormElement>('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("save failed");
});
