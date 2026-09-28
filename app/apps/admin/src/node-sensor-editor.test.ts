import { describe, expect, it } from "vitest";
import { readNodeSensorDraft, serializeNodeSensorDraft } from "./node-sensor-editor";

describe("node sensor draft shared with V2 templates", () => {
  it("round trips all protocol kinds and inline metric metadata", () => {
    const content = [["ad", [["a", "rule", "V"]], 0], ["485", ["cmd", [["b", "rule", "mm"]]]], ["sdi", ["0", [["c", "1"]]]], ["iic", ["SHT30", "0x44", ["d"]]]];
    const metrics = ["a", "b", "c", "d"].map(key => ({key, name: key + "名称", type: "number", unit: key === "a" ? "V" : key === "b" ? "mm" : "", min: 0, max: 100}));
    const draft = readNodeSensorDraft(JSON.stringify(content), JSON.stringify(metrics));
    expect(JSON.parse(serializeNodeSensorDraft(draft).content)).toEqual(content);
    expect(JSON.parse(serializeNodeSensorDraft(draft).metrics)).toEqual(metrics);
    draft[0].mappings![0].key = "voltage";
    expect(JSON.parse(serializeNodeSensorDraft(draft).metrics)[0].key).toBe("voltage");
  });
  it("does not silently discard unsupported protocol or malformed JSON", () => {
    expect(() => readNodeSensorDraft('[["custom", []]]', '[]')).toThrow();
    expect(() => readNodeSensorDraft('{}', '[]')).toThrow();
    expect(() => readNodeSensorDraft('[]', '{')).toThrow();
  });
});
