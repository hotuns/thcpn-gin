export type NodeTimeSchedule = { valid: true; minutes: number[]; hours: number[]; times: string[] } | { valid: false };

// This is a device daily schedule, not an interval or a five-field cron expression.
export function parseNodeTimeSchedule(content: string): NodeTimeSchedule {
  const fields = content.trim().split(/\s+/);
  if (fields.length !== 2) return { valid: false };
  const list = (value: string, max: number): number[] | null => {
    if (!/^\d{1,2}(,\d{1,2})*$/.test(value)) return null;
    const values = value.split(",").map(Number);
    if (values.some(item => item > max)) return null;
    return [...new Set(values)].sort((a, b) => a - b);
  };
  const minutes = list(fields[0], 59);
  const hours = list(fields[1], 23);
  if (!minutes || !hours) return { valid: false };
  const pad = (value: number) => String(value).padStart(2, "0");
  return { valid: true, minutes, hours, times: hours.flatMap(hour => minutes.map(minute => `${pad(hour)}:${pad(minute)}`)) };
}

export function describeNodeTimeSchedule(content: string, locale = "zh-CN"): string {
  const schedule = parseNodeTimeSchedule(content);
  const zh = locale.startsWith("zh");
  if (!schedule.valid) return zh ? "无法识别启动时间，请核对原始配置。" : "Unable to interpret the start times. Check the original configuration.";
  if (schedule.times.length <= 12) return zh ? `每天 ${schedule.times.join("、")} 启动采集` : `Start sampling daily at ${schedule.times.join(", ")}`;
  return zh
    ? `每天 ${schedule.hours.join("、")} 点的 ${schedule.minutes.join("、")} 分启动采集，共 ${schedule.times.length} 次`
    : `Start sampling daily at minute(s) ${schedule.minutes.join(", ")} of hour(s) ${schedule.hours.join(", ")}; ${schedule.times.length} starts per day`;
}
