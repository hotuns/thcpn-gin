import { expect, it } from "vitest";
import { configurationHistory as list, formattedConfiguration } from "./lorawan-v2-config-panel";

it("formats object and encoded JSON history without losing malformed text", () => {
  expect(formattedConfiguration({system:{cid:1}})).toContain('\n  "system": {');
  expect(formattedConfiguration('{"cid":1}')).toBe('{\n  "cid": 1\n}');
  expect(formattedConfiguration("invalid legacy content")).toBe("invalid legacy content");
});

const rows = [{ id: 30, content: [["485", ["command", [["diams", "rule", "mm"]]]]], created_at: "2026-09-28T09:00:00" }];

it("renders history from the array returned by sensor_configs", () => {
  expect(list(rows)).toEqual(rows);
});

it("supports enveloped and paginated configuration history", () => {
  expect(list({ payload: rows })).toEqual(rows);
  expect(list({ data: rows })).toEqual(rows);
  expect(list({ payload: { items: rows } })).toEqual(rows);
  expect(list(undefined)).toEqual([]);
  expect(list({})).toEqual([]);
  expect(list({ data: "invalid" })).toEqual([]);
});
