export const samplingProfileLabels = {
  standard: "标准",
  low_power: "低功耗",
  high_frequency: "高频",
  custom: "自定义",
} as const;

export function describeSamplingControl(input: unknown): string {
  let control = input;
  if (typeof input === "string") {
    try {
      control = JSON.parse(input);
    } catch {
      return "控制配置 JSON 无法解析";
    }
  }
  if (!control || Array.isArray(control) || typeof control !== "object")
    return "未识别采集策略";
  const value = control as Record<string, unknown>;
  const data = typeof value.data_capture_invl === "string" ? value.data_capture_invl : "";
  const image = typeof value.img_capture_invl === "string" ? value.img_capture_invl : "";
  const dataParts = data.trim().split(/\s+/);
  const imageParts = image.trim().split(/\s+/);
  if (dataParts.length !== 2 || dataParts[1] !== "*" || imageParts.length !== 2)
    return "管理员高级自定义计划";
  const dataMinutes = numericList(dataParts[0], 59);
  const imageMinutes = numericList(imageParts[0], 59);
  const imageHours = numericList(imageParts[1], 23);
  if (!dataMinutes || !imageMinutes || imageMinutes.length !== 1 || !imageHours)
    return "管理员高级自定义计划";
  return scheduleSummary(dataMinutes, imageMinutes[0], imageHours);
}

export function scheduleSummary(
  dataMinutes: number[],
  imageMinute: number,
  imageHours: number[],
) {
  const data = [...dataMinutes].sort((a, b) => a - b).map(twoDigit).join("、");
  const images = [...imageHours]
    .sort((a, b) => a - b)
    .map((hour) => `${twoDigit(hour)}:${twoDigit(imageMinute)}`)
    .join("、");
  return `每小时 ${data} 分采集数据；每天 ${images} 采集图片`;
}

const numericList = (value: string, max: number) => {
  const result = value.split(",").map((item) => Number(item.trim()));
  return result.length && result.every((item) => Number.isInteger(item) && item >= 0 && item <= max)
    ? Array.from(new Set(result)).sort((a, b) => a - b)
    : null;
};

const twoDigit = (value: number) => String(value).padStart(2, "0");
