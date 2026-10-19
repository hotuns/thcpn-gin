import { expect, it } from "vitest";
import { configFieldsFromDetail } from "@thcpn/api";
import carbonConfig from "./fixtures/carbon-device-config.json";
import { prepareDeviceConfigSave } from "./config-save-model";
import { copiedDeviceConfigFields } from "./device-config";

it("accepts native Carbon source configuration without requiring THCPN sensorType or port", () => {
  const original = { latest_config: { id: 21, ...carbonConfig } };
  const review = prepareDeviceConfigSave("carbon", configFieldsFromDetail(original), original);
  expect(review.payload).toEqual({ ...carbonConfig, expected_config_id: 21 });
});

it("keeps Carbon empty schedules, null protocol fields, duplicate sensor IDs and extensions intact", () => {
  const config = structuredClone(carbonConfig);
  const content = { ...config, control_json: { ...config.control_json, data_capture_invl: "", misc_invl: " ", vendor: { untouched: true } } };
  const original = { latest_config: { ...content, id: 45 } };
  const payload = prepareDeviceConfigSave("carbon", configFieldsFromDetail(original), original).payload;
  expect(payload).toEqual({ ...content, expected_config_id: 45 });
  expect(payload.data_json).toEqual(config.data_json);
});

it("validates Carbon hardware fields instead of accepting THCPN fields as substitutes", () => {
  const config = { ...carbonConfig, data_json: [{ sensorType: "THCPN", port: "485", params: { contents: [] } }] };
  const original = { latest_config: { ...config, id: 21 } };
  expect(() => prepareDeviceConfigSave("carbon", configFieldsFromDetail(original), original)).toThrow("hardware_interface_type");
});

it("rejects an unavailable Carbon hardware channel", () => {
  const config = structuredClone(carbonConfig);
  config.data_json[0].hardware_interface_channel = 99;
  const original = { latest_config: { ...config, id: 21 } };
  expect(() => prepareDeviceConfigSave("carbon", configFieldsFromDetail(original), original)).toThrow("allowed_hardware_interface_channels");
});

it("checks the native two-field control schedule while allowing empty schedules", () => {
  for (const schedule of ["60 *", "0 24", "*/5 * * * *"]) {
    const original = { latest_config: { ...carbonConfig, id: 21, control_json: { ...carbonConfig.control_json, misc_invl: schedule } } };
    expect(() => prepareDeviceConfigSave("carbon", configFieldsFromDetail(original), original)).toThrow("misc_invl");
  }
});

it("retains the target version when copying Carbon native configuration", () => {
  const source = { latest_config: { ...carbonConfig, id: 900 } };
  const target = { latest_config: { ...carbonConfig, id: 21 } };
  const fields = { ...configFieldsFromDetail(target), ...copiedDeviceConfigFields(source) };
  expect(prepareDeviceConfigSave("carbon", fields, target).payload).toEqual({ ...carbonConfig, expected_config_id: 21 });
});

it("uses Carbon change summaries and flags removed capture instances", () => {
  const original = { latest_config: { ...carbonConfig, id: 21 } };
  const fields = { ...configFieldsFromDetail(original), data_json: "[]" };
  const review = prepareDeviceConfigSave("carbon", fields, original);
  expect(review.changes).toContain("采集配置 3 → 0 项（按 Carbon 接口和协议字段保存）");
  expect(review.destructive).toBe(true);
});

it("keeps THCPN validation independent and refuses an unknown source family", () => {
  const original = { latest_config: { ...carbonConfig, id: 21 } };
  const fields = configFieldsFromDetail(original);
  expect(() => prepareDeviceConfigSave("thcpn", fields, original)).toThrow("缺少型号");
  expect(() => prepareDeviceConfigSave("future", fields, original)).toThrow("不支持");
});
