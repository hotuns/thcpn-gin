import { describe, expect, it } from "vitest";
import { advancedConfigFromDraft, configChangeSummary, configDraftFromDetail, configPayloadFromDraft, duplicateSensorWarnings, formatTwoFieldSchedule, parseAdvancedConfig, parseTwoFieldSchedule, validateVisualConfig } from "./thcpn-config-model";

describe("THCPN visual config model", () => {
  it("round trips unknown fields through visual and advanced representations", () => {
    const draft = configDraftFromDetail({ latest_config: { id: 12, data_json: [{ sensorType: "HCD6818", custom: { keep: true }, params: { command: "aa", contents: [] } }], image_json: [{ key: "key1", vendor: "x" }], control_json: { relay: { pin: 2 } } } });
    const advanced = advancedConfigFromDraft(draft);
    const parsed = parseAdvancedConfig(advanced, 12);
    expect(configPayloadFromDraft(parsed)).toEqual({ data_json: draft.sensors, image_json: draft.images, control_json: draft.control, expected_config_id: 12 });
    expect(parsed.sensors[0].custom).toEqual({ keep: true });
  });

  it("warns about duplicate commands while allowing shared ports", () => {
    const sensors = [
      { sensorType: "A", port: "485", port_num: 3, sensor: "modbusrtu", params: { command: "AA", contents: [] } },
      { sensorType: "B", port: "485", port_num: 3, sensor: "modbusrtu", params: { command: "BB", contents: [] } },
      { sensorType: "C", port: "485", port_num: 3, sensor: "modbusrtu", params: { command: "aa", contents: [] } },
    ];
    expect(duplicateSensorWarnings(sensors)).toHaveLength(1);
  });

  it("parses independent two-field schedules", () => {
    expect(parseTwoFieldSchedule("0,30 *")).toEqual({ minutes: [0, 30], hours: [], wildcardHours: true, valid: true });
    expect(formatTwoFieldSchedule([30, 0, 30], [], true)).toBe("0,30 *");
    expect(parseTwoFieldSchedule("*/5 *").valid).toBe(false);
  });

  it("validates metric and image keys without rejecting shared ports", () => {
    const errors = validateVisualConfig({ expectedConfigId: 1, sensors: [{ sensorType: "A", port: "485", port_num: 3, params: { contents: [{ key: "temp" }, { key: "temp" }] } }, { sensorType: "B", port: "485", port_num: 3, params: { contents: [] } }], images: [{ key: "key1" }, { key: "key1" }], control: {} });
    expect(errors).toContain("传感器 1 的指标 key “temp”重复");
    expect(errors).toContain("图片通道 key “key1”重复");
    expect(errors.some((item) => item.includes("端口"))).toBe(false);
  });

  it("reports replacements even when object counts stay unchanged", () => {
    const before = { expectedConfigId: 1, sensors: [{ sensorType: "A", port: "485", port_num: 1, sensor: "modbusrtu", params: { command: "aa", contents: [{ key: "temp" }] } }], images: [{ key: "key1", port: "http", port_num: 1 }], control: {} };
    const after = { expectedConfigId: 1, sensors: [{ sensorType: "B", port: "485", port_num: 1, sensor: "modbusrtu", params: { command: "bb", contents: [{ key: "humi" }] } }], images: [{ key: "key2", port: "http", port_num: 1 }], control: {} };
    expect(configChangeSummary(before, after)).toMatchObject({ sensorsAdded: 1, sensorsRemoved: 1, metricsChanged: true, imagesAdded: 1, imagesRemoved: 1 });
  });
});
