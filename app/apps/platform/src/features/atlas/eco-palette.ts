/** Keep a few measurement accents while returning most curves to blue-cyan. */
export function ecoMetricColor(unit?: string | null) {
  const key = unit?.trim().toLowerCase() ?? "";
  if (key.includes("%")) return "#86c9ad";
  if (key.includes("°c") || key.includes("℃") || key === "lx" || key === "lux") return "#d6b37c";
  return "#55dfed";
}
