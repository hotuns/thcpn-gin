/** Ecological metric spectrum for Canopy Spatial Observatory charts and badges. */
export function ecoMetricColor(unit?: string): string {
  const value = (unit ?? "").toLowerCase();
  if (value.includes("°c") || value.includes("℃") || value.includes("temp")) return "#fb923c";
  if (value.includes("%") || value.includes("rh") || value.includes("mm")) return "#38bdf8";
  if (value.includes("pa")) return "#a78bfa";
  if (value.includes("w/m") || value.includes("lux") || value.includes("mol") || value.includes("co2") || value.includes("ppm")) return "#fbbf24";
  if (value.includes("m/s") || value.includes("v")) return "#2dd4bf";
  return "#34d399";
}
