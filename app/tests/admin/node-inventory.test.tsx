// @vitest-environment jsdom
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { App, ConfigProvider } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventually, render } from "../render";
import { api } from "@thcpn/api";
import { LoRaWANNodeInventory } from "../../apps/admin/src/lorawan-node-inventory";

const csv = "sn,node_index\nNODE-A,3\nNODE-B,8\n";
const previewRows = [
  { line: 2, sn: "NODE-A", node_index: 3 },
  { line: 3, sn: "NODE-B", node_index: 8 },
];
// jsdom does not implement the layout APIs used by Ant Design's table/select.
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
  vi.spyOn(api.admin, "sources").mockResolvedValue({ items: [
    { id: "source-1", name: "节点源", source_family: "lorawan_v2", status: "active" },
  ] });
  vi.spyOn(api.admin, "physicalNodeGateways").mockResolvedValue({ items: [
    { id: "gateway-1", name: "北区网关", sn: "GW-NORTH" },
  ] });
  vi.spyOn(api.admin, "sourcePhysicalNodes").mockResolvedValue({ data: [], pagination: { total_count: 0 } });
  vi.spyOn(api.admin, "previewPhysicalNodeCSV").mockResolvedValue({ items: previewRows });
  vi.spyOn(api.admin, "registerPhysicalNode").mockResolvedValue({ status: "completed", bound: true, message: "安装完成" });
  vi.spyOn(api.admin, "changePhysicalNode").mockResolvedValue({ status: "completed", message: "指标已同步" });
});

function button(name: string, scope: ParentNode = document.body): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button"))
    .find(element => element.textContent?.replace(/\s/g, "") === name.replace(/\s/g, ""));
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function importDialog(): HTMLElement {
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
    .find(element => element.textContent?.includes("CSV 批量新建节点并安装"));
  if (!dialog) throw new Error("CSV import dialog is not open");
  return dialog;
}

function confirmationDialog(): HTMLElement {
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
    .find(element => element.textContent?.includes("确认批量新建并安装"));
  if (!dialog) throw new Error("Import confirmation is not open");
  return dialog;
}

function row(sn: string): HTMLTableRowElement {
  const found = Array.from(importDialog().querySelectorAll<HTMLTableRowElement>("tbody tr"))
    .find(element => Array.from(element.querySelectorAll("td")).some(cell => cell.textContent === sn));
  if (!found) throw new Error(`Missing preview row: ${sn}`);
  return found;
}

async function openAndPreview(text = csv) {
  await render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App>
        <MemoryRouter initialEntries={["/admin/nodes?source=source-1&gateway=gateway-1"]}>
          <LoRaWANNodeInventory />
        </MemoryRouter>
      </App>
    </ConfigProvider>,
  );
  await eventually(() => expect(button("CSV 新建并安装").disabled).toBe(false));
  await click(button("CSV 新建并安装"));
  const input = importDialog().querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("CSV file input is missing");
  const file = new File([text], "nodes.csv", { type: "text/csv" });
  // File.text() is available in browsers, but is absent from jsdom's File.
  Object.defineProperty(file, "text", { value: async () => text });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await eventually(() => expect(api.admin.previewPhysicalNodeCSV).toHaveBeenCalledWith(text, false));
  await eventually(() => expect(importDialog().textContent).toContain("NODE-A"));
}

async function confirmImport() {
  await eventually(() => expect(button("开始新建并安装", importDialog()).disabled).toBe(false));
  await click(button("开始新建并安装", importDialog()));
  await click(button("OK", confirmationDialog()));
}

describe("physical node CSV import submission boundaries", () => {
  it("previews and opens confirmation without writing; cancelling keeps the preview editable", async () => {
    await openAndPreview();
    expect(api.admin.registerPhysicalNode).not.toHaveBeenCalled();
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();

    await click(button("开始新建并安装", importDialog()));
    expect(confirmationDialog()).toBeDefined();
    expect(api.admin.registerPhysicalNode).not.toHaveBeenCalled();
    await click(button("Cancel", confirmationDialog()));

    expect(api.admin.registerPhysicalNode).not.toHaveBeenCalled();
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();
    expect(button("开始新建并安装", importDialog()).disabled).toBe(false);
  });

  it("registers only the rows returned by the preview on the selected gateway after confirmation", async () => {
    const uploaded = `${csv}IGNORED-BY-PREVIEW,99\n`;
    await openAndPreview(uploaded);
    await confirmImport();

    await eventually(() => expect(api.admin.changePhysicalNode).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.admin.registerPhysicalNode).mock.calls).toEqual([
      ["source-1", { sn: "NODE-A", node_index: 3, gateway_device_id: "gateway-1" }],
      ["source-1", { sn: "NODE-B", node_index: 8, gateway_device_id: "gateway-1" }],
    ]);
    expect(api.admin.changePhysicalNode).toHaveBeenCalledWith("gateway-1", { action: "reconcile" });
    await eventually(() => {
      expect(row("NODE-A").textContent).toContain("已新建并安装");
      expect(row("NODE-B").textContent).toContain("已新建并安装");
      expect(button("开始新建并安装", importDialog()).disabled).toBe(true);
    });
  });

  it("blocks the entire import when any preview row has a validation error", async () => {
    vi.mocked(api.admin.previewPhysicalNodeCSV).mockResolvedValue({ items: [
      previewRows[0], { ...previewRows[1], error: "序号重复" },
    ] });
    await openAndPreview();

    expect(row("NODE-B").textContent).toContain("序号重复");
    expect(button("开始新建并安装", importDialog()).disabled).toBe(true);
    await click(button("开始新建并安装", importDialog()));
    expect(api.admin.registerPhysicalNode).not.toHaveBeenCalled();
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();
  });

  it("keeps a rejected row failed while continuing other rows and synchronizing successful installs", async () => {
    vi.mocked(api.admin.registerPhysicalNode)
      .mockRejectedValueOnce(new Error("节点位置已占用"))
      .mockResolvedValueOnce({ status: "completed", bound: true, message: "第二行已安装" });
    await openAndPreview();
    await confirmImport();

    await eventually(() => {
      expect(row("NODE-A").textContent).toContain("失败");
      expect(row("NODE-A").textContent).not.toContain("已新建并安装");
      expect(row("NODE-B").textContent).toContain("已新建并安装");
    });
    expect(api.admin.registerPhysicalNode).toHaveBeenCalledTimes(2);
    expect(api.admin.changePhysicalNode).toHaveBeenCalledTimes(1);
    expect(button("开始新建并安装", importDialog()).disabled).toBe(true);
  });

  it("stops subsequent submissions when a row's outcome is unknown", async () => {
    vi.mocked(api.admin.registerPhysicalNode).mockResolvedValueOnce({
      status: "unknown", bound: false, message: "源端响应超时，请核对结果",
    });
    await openAndPreview();
    await confirmImport();

    await eventually(() => {
      expect(row("NODE-A").textContent).toContain("结果未确认");
      expect(importDialog().textContent).toContain("已停止后续行");
    });
    expect(api.admin.registerPhysicalNode).toHaveBeenCalledTimes(1);
    expect(row("NODE-A").textContent).not.toContain("已新建并安装");
    expect(row("NODE-B").textContent).toContain("等待");
    expect(api.admin.changePhysicalNode).not.toHaveBeenCalled();
    expect(button("开始新建并安装", importDialog()).disabled).toBe(true);
  });

  it("preserves installed row results and prevents another import if the final platform sync fails", async () => {
    vi.mocked(api.admin.changePhysicalNode).mockRejectedValueOnce(new Error("同步超时"));
    await openAndPreview();
    await confirmImport();

    await eventually(() => expect(importDialog().textContent).toContain("平台指标同步失败"));
    expect(row("NODE-A").textContent).toContain("已新建并安装");
    expect(row("NODE-B").textContent).toContain("已新建并安装");
    expect(importDialog().textContent).toContain("不要重复导入");
    expect(button("开始新建并安装", importDialog()).disabled).toBe(true);
    await click(button("开始新建并安装", importDialog()));
    expect(api.admin.registerPhysicalNode).toHaveBeenCalledTimes(2);
    expect(api.admin.changePhysicalNode).toHaveBeenCalledTimes(1);
  });
});
