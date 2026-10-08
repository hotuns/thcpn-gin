import { describe, expect, it } from "vitest";
import { attachMetricInfo, collectMetricInfo, v1ToV2Content } from "./admin-sensors";

it("copies V1 485 mappings without mutating the original or carrying wait time", () => {
  const source = { port: "485", params: { command: "0103", wait_time: 60, contents: [{ key: "temp", decode: "0,0.1,0,>2i", info: { name: "温度", unit: "℃" } }] } };
  const before = JSON.stringify(source);
  expect(v1ToV2Content(source)).toEqual([["485", ["0103", [["temp", "0,0.1,0,>2i", "℃"]]]]]);
  expect(JSON.stringify(source)).toBe(before);
  expect(v1ToV2Content({ ...source, port: "unknown" })).toEqual([]);
  expect(v1ToV2Content({ ...source, port: "ad", port_num: 2 })).toEqual([["ad", [["temp", "0,0.1,0,>2i", "℃"]], 2]]);
});

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
