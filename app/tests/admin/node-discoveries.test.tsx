// @vitest-environment jsdom
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { App, ConfigProvider } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type LoRaWANNodeDiscovery, type LoRaWANNodeDiscoveryList } from "@thcpn/api";
import { AdminDeviceNodes } from "../../apps/admin/src/admin-device-installation";
import { eventually, render } from "../render";

const discovery: LoRaWANNodeDiscovery = {
  id: 11, gateway_sn: "GATEWAY-A", node_index: 55, node_sn: "aabbccddeeff",
  status: "pending", reason: "slot_occupied", current_node_sn: "112233445566",
  bound_gateway_sn: null, bound_node_index: null,
  first_seen_at: "2026-11-15T08:53:39Z", last_seen_at: "2026-11-16T00:13:35Z",
  seen_count: 38, resolved_at: null,
};

function page(...data: LoRaWANNodeDiscovery[]): LoRaWANNodeDiscoveryList {
  return { data, pagination: { current_page: 1, page_size: 20, total_count: data.length, total_page: data.length ? 1 : 0 } };
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => getComputedStyle(element));
  vi.spyOn(api.admin, "physicalNodes").mockResolvedValue({});
  vi.spyOn(api.admin, "deviceNodes").mockResolvedValue({ items: [] });
  vi.spyOn(api.admin, "changePhysicalNode").mockResolvedValue({ status: "completed" });
});

async function mountNodes(compact = false) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App>
        <MemoryRouter>
          <AdminDeviceNodes compact={compact} device={{ id: "gateway-1", source_family: "lorawan_v2" }} onData={() => {}} />
        </MemoryRouter>
      </App>
    </ConfigProvider>,
  );
}

function button(scope: ParentNode, name: string) {
  const found = Array.from(scope.querySelectorAll("button")).find(element =>
    element.textContent?.replace(/\s/g, "") === name.replace(/\s/g, ""),
  );
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}

describe("gateway node replacement discoveries", () => {
  it("shows both SNs and writes exactly once only after explicit confirmation", async () => {
    const list = vi.spyOn(api.admin, "nodeDiscoveries").mockResolvedValueOnce(page(discovery)).mockResolvedValue(page());
    const { host } = await mountNodes();
    await eventually(() => expect(host.textContent).toContain("待确认节点"));
    await eventually(() => expect(host.textContent).toContain(discovery.node_sn));
    expect(host.textContent).toContain(discovery.current_node_sn);
    expect(list).toHaveBeenCalledWith("gateway-1", 1, 20);
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();

    await act(async () => button(host, "确认更换").click());
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("Replacement confirmation is not open");
    expect(dialog.textContent).toContain(discovery.node_sn);
    expect(dialog.textContent).toContain(discovery.current_node_sn);
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();
    await act(async () => button(dialog, "取消").click());
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();

    await act(async () => button(host, "确认更换").click());
    const reopened = document.querySelector('[role="dialog"]');
    if (!reopened) throw new Error("Replacement confirmation is not open");
    await act(async () => button(reopened, "确认更换").click());

    expect(api.admin.changePhysicalNode).toHaveBeenCalledTimes(1);
    expect(api.admin.changePhysicalNode).toHaveBeenCalledWith("gateway-1", { action: "replace", sn: discovery.node_sn, node_index: 55 });
    await eventually(() => expect(host.textContent).not.toContain("待确认节点"));
  });

  it("shows the other binding and prevents replacing with a node installed elsewhere", async () => {
    vi.spyOn(api.admin, "nodeDiscoveries").mockResolvedValue(page({
      ...discovery, reason: "node_bound_elsewhere", bound_gateway_sn: "GATEWAY-B", bound_node_index: 7,
    }));
    const { host } = await mountNodes();
    await eventually(() => expect(host.textContent).toContain("GATEWAY-B"));
    const replace = button(host, "确认更换");
    expect(replace.disabled).toBe(true);
    await act(async () => replace.click());
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();
  });

  it("shows an explicitly registered legacy position without an SN and reads its runtime", async () => {
    vi.spyOn(api.admin, "nodeDiscoveries").mockResolvedValue(page());
    vi.mocked(api.admin.deviceNodes).mockResolvedValue({ items: [{
      key: "gateway:gateway-1:node:55", name: "旧节点", custom_name: "旧节点", can_rename: true,
      target: { kind: "gateway_node", gateway_device_id: "gateway-1", node_index: 55 },
      indexed_only: true, bound: false, streams: [],
    }] });
    const runtime = vi.spyOn(api.admin, "nodeRuntime").mockResolvedValue({ items: [], refreshed_at: discovery.last_seen_at });
    const { host } = await mountNodes();
    await eventually(() => expect(host.textContent).toContain("按序号接入"));
    expect(host.textContent).toContain("旧节点");
    await eventually(() => expect(runtime).toHaveBeenCalledWith("gateway-1", [55]));
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();
  });

  it("does not request discoveries from the compact device list", async () => {
    const list = vi.spyOn(api.admin, "nodeDiscoveries").mockResolvedValue(page(discovery));
    await mountNodes(true);
    expect(list).not.toHaveBeenCalled();
  });
});
