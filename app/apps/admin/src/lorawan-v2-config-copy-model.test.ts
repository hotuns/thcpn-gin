import { expect, it } from "vitest";
import { gatewayConfigCopyDraft, latestGatewayConfiguration, sensorConfigCopyDraft } from "./lorawan-v2-config-copy-model";

it("copies gateway configuration with the target identity and no source config ID", () => {
  const config = { system: { did: "SOURCE", cid: 12, log_print_lvl: "all" }, platform: { topic: "{device_sn}/data" }, vendor: { retained: true } };
  const result = JSON.parse(gatewayConfigCopyDraft({ id: 12, config_content: config }, "TARGET"));
  expect(result).toEqual({ ...config, system: { did: "TARGET", log_print_lvl: "all" } });
  expect(config.system).toEqual({ did: "SOURCE", cid: 12, log_print_lvl: "all" });
});

it("handles encoded gateway content and rejects malformed or absent configuration", () => {
  expect(JSON.parse(gatewayConfigCopyDraft({ content: '{"vendor":42}' }, "TARGET"))).toEqual({ vendor: 42, system: { did: "TARGET" } });
  expect(() => gatewayConfigCopyDraft({ config_content: "[]" }, "TARGET")).toThrow();
  expect(() => gatewayConfigCopyDraft({ config_content: { system: [] } }, "TARGET")).toThrow();
  expect(() => gatewayConfigCopyDraft({ config_content: {} }, "")).toThrow();
});

it("uses the newest configuration in the returned history", () => {
  expect(latestGatewayConfiguration({ payload: { items: [{ id: 1 }, { id: 8 }, { id: 4 }] } })).toEqual({ id: 8 });
  expect(() => latestGatewayConfiguration({ items: [] })).toThrow("尚未保存");
});

it("copies node protocols, metric semantics and wait time without node or version identifiers", () => {
  const content = [["485", ["01030000", [["temp", "rule", "℃"]]]]];
  const metrics = [{ key: "temp", name: "温度", range: { min: -20, max: 60 } }];
  const result = sensorConfigCopyDraft({ id: 8, node_index: 5, content, metrics, wait_time: 17 });
  expect(JSON.parse(result.content)).toEqual(content);
  expect(JSON.parse(result.metrics)).toEqual(metrics);
  expect(result.waitTime).toBe(17);
  expect(Object.keys(result).sort()).toEqual(["content", "metrics", "waitTime"]);
});

it("rejects unavailable node configuration and invalid wait time", () => {
  expect(() => sensorConfigCopyDraft({})).toThrow();
  expect(() => sensorConfigCopyDraft({ content: [], metrics: {} })).toThrow();
  expect(() => sensorConfigCopyDraft({ content: [], wait_time: 65536 })).toThrow();
  expect(sensorConfigCopyDraft({ content: [], wait_time: 0 }).waitTime).toBe(0);
});
