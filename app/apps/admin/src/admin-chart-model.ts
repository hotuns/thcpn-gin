import type { CarbonFluxPoint, CarbonRawPhase } from "@thcpn/api";

export type AdminChartSeries = {
  id: string;
  name: string;
  code?: string;
  unit?: string | null;
  points: Array<{ ts: string; value?: number | null }>;
};

// Keep every returned observation, including explicit gaps and repeated times.
// Sorting is only for drawing a chronological path; this does not resample.
export function prepareAdminCurve(points: AdminChartSeries["points"]) {
  const data = points.flatMap(point => {
    const time = Date.parse(point.ts);
    return Number.isFinite(time)
      ? [{ time, value: typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null }]
      : [];
  }).sort((left, right) => left.time - right.time);
  const valid = data.filter((point): point is { time: number; value: number } => point.value !== null);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const point of valid) {
    minimum = Math.min(minimum, point.value);
    maximum = Math.max(maximum, point.value);
  }
  return {
    data,
    count: valid.length,
    latest: valid.at(-1),
    minimum: valid.length ? minimum : undefined,
    maximum: valid.length ? maximum : undefined,
    rejectedTimes: points.length - data.length,
  };
}

const axisTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
export const adminChartTime = (time: number) => Number.isFinite(time) ? axisTime.format(new Date(time)) : "—";
export const adminChartNumber = (value?: number) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 6 }).format(value);

export function carbonFluxCurves(points: CarbonFluxPoint[]): AdminChartSeries[] {
  return (["nee", "er", "gpp"] as const).map(key => ({
    id: key, name: key.toUpperCase(), unit: "μg CO₂·m⁻²·s⁻¹",
    points: points.map(point => ({ ts: point.period_at, value: point[key] })),
  }));
}

export function carbonPhaseCurves(phase: CarbonRawPhase): AdminChartSeries[] {
  const metrics = [
    { key: "co2", name: "CO₂ 浓度", unit: "ppm" },
    { key: "temperature", name: "气室温度", unit: "℃" },
    { key: "humidity", name: "气室湿度", unit: "%" },
    { key: "temp_l", name: "明室温度", unit: "℃" },
    { key: "humi_l", name: "明室湿度", unit: "%" },
    { key: "temp_b", name: "暗室温度", unit: "℃" },
    { key: "humi_b", name: "暗室湿度", unit: "%" },
    { key: "stemp", name: "土壤温度", unit: "℃" },
    { key: "shumi", name: "土壤湿度", unit: "%" },
  ] as const;
  return metrics.filter(metric => phase.points.some(point => typeof point[metric.key] === "number"))
    .map(metric => ({ id: `${phase.room}:${metric.key}`, name: metric.name, unit: metric.unit, code: metric.key,
      points: phase.points.map(point => ({ ts: point.ts, value: point[metric.key] })),
    }));
}
