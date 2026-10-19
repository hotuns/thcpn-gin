// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Form } from "@thcpn/admin-ui";
import type { FormInstance } from "antd";
import { configFieldsFromDetail, type DeviceConfigFields } from "@thcpn/api";
import { DeviceConfigEditor } from "./device-config-editor";
import { prepareDeviceConfigSave } from "./config-save-model";
import { copiedDeviceConfigFields } from "./device-config";
import carbonConfig from "./fixtures/carbon-device-config.json";

let root: Root;
let host: HTMLDivElement;
let form: FormInstance<DeviceConfigFields>;
const original = { latest_config: { ...carbonConfig, id: 21 } };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computedStyle(element));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  function Editor() {
    const [instance] = Form.useForm<DeviceConfigFields>(); form = instance;
    return <Form form={instance} initialValues={configFieldsFromDetail(original)}><DeviceConfigEditor sourceFamily="carbon" deviceId="target" form={instance} /></Form>;
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Editor />));
}

it("renders Carbon native fields and collects all sections even before their tabs are opened", async () => {
  await mount();
  expect(host.querySelector('[aria-label="Carbon 配置编辑器"]')).not.toBeNull();
  expect(host.textContent).toContain("hardware_interface_type/channel");
  expect(host.textContent).not.toContain("缺少型号");
  expect(host.querySelector(".ant-alert-error")).toBeNull();
  let fields!: DeviceConfigFields;
  await act(async () => { fields = await form.validateFields(); });
  expect(prepareDeviceConfigSave("carbon", fields, original).payload).toEqual({ ...carbonConfig, expected_config_id: 21 });
});

it("loads copied native JSON without copying the source version or losing null protocol parameters", async () => {
  await mount();
  const copiedConfig = { ...carbonConfig, control_json: { ...carbonConfig.control_json, data_capture_invl: "", custom: { keep: true } } };
  const source = { latest_config: { ...copiedConfig, id: 900 } };
  await act(async () => form.setFieldsValue(copiedDeviceConfigFields(source)));
  let fields!: DeviceConfigFields;
  await act(async () => { fields = await form.validateFields(); });
  expect(prepareDeviceConfigSave("carbon", fields, original).payload).toEqual({ ...copiedConfig, expected_config_id: 21 });
  expect(host.querySelector(".ant-alert-error")).toBeNull();
});

it("shows Carbon field errors instead of THCPN model and port requirements", async () => {
  await mount();
  const config = structuredClone(carbonConfig);
  config.data_json[0].hardware_interface_type = "";
  await act(async () => form.setFieldValue("data_json", JSON.stringify(config.data_json)));
  expect(host.querySelector(".ant-alert-error")?.textContent).toContain("hardware_interface_type");
  expect(host.querySelector(".ant-alert-error")?.textContent).not.toContain("缺少型号");
});
