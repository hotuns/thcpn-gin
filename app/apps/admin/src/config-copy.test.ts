import { expect, it } from "vitest";
import { configCopyCandidates } from "./config-copy";
import { copiedDeviceConfigFields } from "./device-config";

const target = { id: "target", source_family: "thcpn", device_type: "gateway_node", product_id: "station-a" };

it("only lists matching source family, role and product, excluding the target", () => {
  const compatible = { ...target, id: "compatible" };
  expect(configCopyCandidates(target, [target, compatible,
    { ...compatible, id: "carbon", source_family: "carbon" },
    { ...compatible, id: "gateway", device_type: "gateway" },
    { ...compatible, id: "other-model", product_id: "station-b" },
    { ...compatible, id: "unknown-product", product_id: undefined },
  ])).toEqual([compatible]);
});

it("supports another node on the current gateway without guessing an unknown source", () => {
  expect(configCopyCandidates(target, [target], true)).toEqual([target]);
  expect(configCopyCandidates({ ...target, source_family: undefined }, [target])).toEqual([]);
  expect(configCopyCandidates({ ...target, device_type: undefined }, [target])).toEqual([]);
  expect(configCopyCandidates({ ...target, id: undefined }, [target])).toEqual([]);
});

it("copies only editable configuration and retains the target version and device identity", () => {
  const source = { device_id: "source", latest_config: { id: 900, device_id: 42, data_json: [{ vendor_field: { retained: true } }], image_json: [], control_json: { schedule: { hours: [1] } } } };
  const current = { expected_config_id: 21, device_id: "target", data_json: "[]" };
  const copied = copiedDeviceConfigFields(source);
  expect({ ...current, ...copied }).toMatchObject({ expected_config_id: 21, device_id: "target" });
  expect(Object.keys(copied).sort()).toEqual(["control_json", "data_json", "image_json"]);
  expect(JSON.parse(copied.data_json)).toEqual(source.latest_config.data_json);
  expect(JSON.parse(copied.control_json)).toEqual(source.latest_config.control_json);
});

it("rejects missing versions and unsupported source config instead of replacing the draft with empty values", () => {
  expect(() => copiedDeviceConfigFields({})).toThrow();
  expect(() => copiedDeviceConfigFields({ latest_config: { id: 9, data_json: { legacy: true } } })).toThrow();
});
