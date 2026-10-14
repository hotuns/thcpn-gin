import { expect, it } from "vitest";
import { validateSensorWaitTime } from "./sensor-config-wait-time";
it.each([0, 10, 65535])("preserves configured wait_time %s without forcing zero", value => {
  expect(validateSensorWaitTime(value)).toBe(value);
});
it.each([null, -1, 65536, 1.5, NaN, Infinity])("rejects invalid wait_time %s", value => {
  expect(() => validateSensorWaitTime(value)).toThrow();
});
