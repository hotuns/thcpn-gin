import { describe, expect, it } from "vitest";
import { configFieldsFromDetail, parseTHCPNConfig } from "./thcpn-config";

describe("THCPN config form", () => {
  it("extracts only editable fields from the detail response", () => {
    const fields = configFieldsFromDetail({ device_id: "device-1", latest_config: { id: 9, data_json: [{ key: "temp" }], image_json: [], control_json: { relay: true } }, latest_snapshot: { id: "snapshot-1" } });
    expect(JSON.parse(fields.data_json)).toEqual([{ key: "temp" }]);
    expect(parseTHCPNConfig(fields)).toEqual({ data_json: [{ key: "temp" }], image_json: [], control_json: { relay: true } });
  });

  it("rejects data and image objects and control arrays", () => {
    expect(() => parseTHCPNConfig({ data_json: "{}", image_json: "[]", control_json: "{}" })).toThrow("data_json");
    expect(() => parseTHCPNConfig({ data_json: "[]", image_json: "{}", control_json: "{}" })).toThrow("image_json");
    expect(() => parseTHCPNConfig({ data_json: "[]", image_json: "[]", control_json: "[]" })).toThrow("control_json");
  });
});
