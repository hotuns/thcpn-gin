import { describe, expect, it } from "vitest";
import { attachMetricInfo, collectMetricInfo } from "./admin-sensors";

describe("V2 inline metric editing", () => {
  it("joins existing definitions to protocol rows and saves edited metadata", () => {
    const items = attachMetricInfo([{ kind: "485", command: "abc", mappings: [{ key: "temp", rule: "decode", unit: "℃" }] }], [
      { key: "temp", info: { name: "温度", type: "temperature", min: -40, max: 80, index: 3 } },
    ]);
    expect(items[0].mappings?.[0].info).toMatchObject({ name: "温度", unit: "℃", min: -40, index: 3 });
    items[0].mappings![0].key = "temperature";
    expect(collectMetricInfo(items)).toEqual([{ key: "temperature", info: { name: "温度", type: "temperature", unit: "℃", min: -40, max: 80, index: 3 } }]);
    items[0].mappings = [];
    expect(collectMetricInfo(items)).toEqual([]);
  });
});
