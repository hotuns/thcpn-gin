import area from "@turf/area";
import length from "@turf/length";
import type { Feature, Geometry } from "geojson";
import type { StyleSpecification } from "maplibre-gl";



export function geometryMeasure(feature: Feature<Geometry>) {
  if (feature.geometry.type === "Polygon") return `${(area(feature) / 10000).toFixed(3)} ha · ${(length({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: feature.geometry.coordinates[0] } }, { units: "kilometers" }) * 1000).toFixed(1)} m 周长`;
  if (feature.geometry.type === "LineString") return `${(length(feature, { units: "kilometers" }) * 1000).toFixed(1)} m`;
  return "";
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportCanvas(canvas: HTMLCanvasElement, filename: string, note: string) {
  const out = document.createElement("canvas"); out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext("2d"); if (!ctx) throw new Error("截图画布不可用");
  ctx.drawImage(canvas, 0, 0); const height = Math.max(32, out.height * .035);
  ctx.fillStyle = "#071b2bec"; ctx.fillRect(0, out.height - height, out.width, height);
  ctx.fillStyle = "#d2efff"; ctx.font = `${Math.max(12, height * .42)}px system-ui`; ctx.fillText(note, 12, out.height - height * .35);
  return new Promise<void>((resolve, reject) => out.toBlob(blob => { if (blob) { downloadBlob(blob, filename); resolve(); } else reject(new Error("PNG encoding failed")); }, "image/png"));
}
export function mapSourceCredit(style: StyleSpecification) {
  return [...new Set(Object.values(style.sources).flatMap(source => "attribution" in source && typeof source.attribution === "string" ? [source.attribution.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()] : []))].join(" · ");
}
export function comparisonCanvas(before: HTMLCanvasElement, after: HTMLCanvasElement, split: number) {
  const canvas = document.createElement("canvas"); canvas.width = before.width; canvas.height = before.height;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Comparison canvas unavailable");
  const x = canvas.width * Math.max(0, Math.min(100, split)) / 100;
  ctx.drawImage(before, 0, 0); ctx.save(); ctx.beginPath(); ctx.rect(x, 0, canvas.width - x, canvas.height); ctx.clip(); ctx.drawImage(after, 0, 0, canvas.width, canvas.height); ctx.restore();
  return canvas;
}
