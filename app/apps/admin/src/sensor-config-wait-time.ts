export function validateSensorWaitTime(value: number | null): number {
  if (value === null || !Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error("等待时间必须为 0–65535 秒的整数。");
  }
  return value;
}
