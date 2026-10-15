// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type FirmwareArtifact, type FirmwareCandidate, type FirmwareRelease } from "@thcpn/api";
import { AdminFirmwarePage } from "./admin-firmware";
import { DeviceFirmwareDialog } from "./device-firmware-dialog";
import { I18nProvider, useLocale } from "@thcpn/i18n";

let root: Root; let host: HTMLDivElement; let client: QueryClient;
const artifact: FirmwareArtifact = { id: "firmware", data_source_id: "lora-source", data_source_name: "LoRa source", device_type: "gateway", source_family: "lorawan_v2", original_filename: "gateway.bin", object_key: "firmwares/test.bin", public_url: "https://lora.example.test/firmwares/test.bin", content_type: "application/octet-stream", size_bytes: 4096, version: "5.2.1", firmware_version: 84017408, verify_value: "0123456789abcdef0123456789abcdef", archived: false, created_at: "2026-10-15T00:00:00Z" };
const candidate: FirmwareCandidate = { id: "device", name: "Gateway", serial_no: "GW-1", data_source_id: "lora-source", data_source_name: "LoRa source", source_family: "lorawan_v2", device_type: "gateway" };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computedStyle(element));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.spyOn(api.admin, "firmwares").mockResolvedValue({ items: [artifact], total: 1 });
  vi.spyOn(api.admin, "firmwareCandidates").mockResolvedValue({ items: [candidate] });
  vi.spyOn(api.admin, "firmwareReleases").mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(api.admin, "sources").mockResolvedValue({ items: [{ id: "lora-source", name: "LoRa source", source_family: "lorawan_v2", status: "active" }] });
});
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); client?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Page({ children }: { children?: ReactNode }) { const { setLocale } = useLocale(); useEffect(() => { void setLocale("zh-CN"); }, []); return children ?? <AdminFirmwarePage />; }
async function mount(children?: ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(<I18nProvider><MemoryRouter><QueryClientProvider client={client}><Page>{children}</Page></QueryClientProvider></MemoryRouter></I18nProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""))!;
it("shows the reusable library and asks the server for compatible targets before publishing", async () => {
  const upload = vi.spyOn(api.admin, "uploadFirmware"); const publish = vi.spyOn(api.admin, "publishFirmware");
  await mount();
  expect(host.textContent).toContain("gateway.bin"); expect(host.textContent).toContain("LoRa source");
  await act(async () => button("发布所选固件").click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(api.admin.firmwareCandidates).toHaveBeenCalledWith("firmware");
  expect(document.querySelector(".ant-modal")?.textContent).toContain("不会重新上传文件");
  expect(document.querySelector<HTMLButtonElement>(".ant-modal-footer .ant-btn-primary")?.disabled).toBe(true);
  expect(upload).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
});
it("blocks publishing archived firmware", async () => {
  vi.mocked(api.admin.firmwares).mockResolvedValue({ items: [{ ...artifact, archived: true }], total: 1 });
  await mount(); expect(button("发布所选固件").disabled).toBe(true); expect(host.textContent).toContain("已归档");
});
it("publishes an existing artifact only after target selection and explicit confirmation", async () => {
  const publish = vi.spyOn(api.admin, "publishFirmware").mockResolvedValue({ ...artifact, status: "completed", targets: [], updated_at: artifact.created_at });
  const upload = vi.spyOn(api.admin, "uploadFirmware");
  await mount(); await act(async () => button("发布所选固件").click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const input = document.querySelector<HTMLInputElement>('.ant-modal input[role="combobox"]')!;
  await act(async () => input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  const option = document.querySelector<HTMLElement>(".ant-select-item-option")!;
  expect(option.textContent).toContain("GW-1");
  await act(async () => option.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal-footer .ant-btn-primary")!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(publish).not.toHaveBeenCalled();
  expect(document.querySelector(".ant-modal-confirm")?.textContent).toContain("确认登记到以下设备");
  await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal-confirm .ant-btn-primary")!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(publish).toHaveBeenCalledWith({ firmware_id: "firmware", device_ids: ["device"], idempotency_key: expect.any(String) });
  expect(upload).not.toHaveBeenCalled();
});
it("uploads by data source without requesting a reference device", async () => {
  const upload = vi.spyOn(api.admin, "uploadFirmware"); const publish = vi.spyOn(api.admin, "publishFirmware");
  await mount(); await act(async () => button("上传入库").click());
  expect(document.querySelector(".ant-modal")?.textContent).not.toContain("参考设备");
  expect(document.querySelector(".ant-modal")?.textContent).toContain("入库不会升级设备");
  expect(api.admin.firmwareCandidates).not.toHaveBeenCalled();
  expect(document.querySelector(".ant-modal .ant-select-multiple")).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal-footer .ant-btn-primary")!.click());
  expect(upload).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
});

it("upgrades only the current device in-place after choosing library firmware and confirming", async () => {
  const publish = vi.spyOn(api.admin, "publishFirmware").mockResolvedValue({ ...artifact, id: "release", status: "completed", targets: [], updated_at: artifact.created_at });
  const close = vi.fn();
  await mount(<DeviceFirmwareDialog deviceId="device" deviceName="Current gateway" serialNo="GW-1" onClose={close} />);
  expect(api.admin.firmwares).toHaveBeenCalledWith({ device_id: "device", page: 1, page_size: 10 });
  expect(document.querySelector(".ant-modal")?.textContent).toContain("Current gateway");
  expect(button("发布所选固件").disabled).toBe(true);
  await act(async () => document.querySelector<HTMLInputElement>('.ant-modal input[type="radio"]')!.click());
  await act(async () => button("发布所选固件").click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(publish).not.toHaveBeenCalled();
  expect(document.querySelector(".ant-modal-confirm")?.textContent).toContain("Current gateway");
  await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal-confirm .ant-btn-primary")!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(publish).toHaveBeenCalledWith({ firmware_id: "firmware", device_ids: ["device"], idempotency_key: expect.any(String) });
  expect(close).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("登记完成不代表设备已升级");
});
it("shows device firmware loading errors without enabling publishing", async () => {
  vi.mocked(api.admin.firmwares).mockRejectedValue(new Error("library unavailable"));
  await mount(<DeviceFirmwareDialog deviceId="device" deviceName="Gateway" serialNo="GW-1" onClose={vi.fn()} />);
  expect(document.querySelector(".ant-alert-error")).not.toBeNull();
  expect(button("发布所选固件").disabled).toBe(true);
});
it("retries a failed device registration without uploading or creating another release", async () => {
  const failed: FirmwareRelease = { ...artifact, id: "release", status: "failed", updated_at: artifact.created_at, targets: [{ id: "target", release_id: "release", device_id: "device", device_name: "Gateway", data_source_id: "lora-source", gateway_sn: "GW-1", status: "failed", error_message: "source unavailable", retry_count: 0, created_at: artifact.created_at, updated_at: artifact.created_at }] };
  const publish = vi.spyOn(api.admin, "publishFirmware").mockResolvedValue(failed);
  const retry = vi.spyOn(api.admin, "retryFirmwareReleaseTarget").mockResolvedValue({ ...failed, status: "completed", targets: [{ ...failed.targets[0], status: "completed", error_message: "" }] });
  const upload = vi.spyOn(api.admin, "uploadFirmware");
  await mount(<DeviceFirmwareDialog deviceId="device" deviceName="Gateway" serialNo="GW-1" onClose={vi.fn()} />);
  await act(async () => document.querySelector<HTMLInputElement>('.ant-modal input[type="radio"]')!.click());
  await act(async () => button("发布所选固件").click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal-confirm .ant-btn-primary")!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(document.body.textContent).toContain("source unavailable");
  await act(async () => button("重试").click());
  expect(retry).toHaveBeenCalledWith("release", "target");
  expect(publish).toHaveBeenCalledOnce(); expect(upload).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("登记完成不代表设备已升级");
});
