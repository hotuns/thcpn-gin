import area from "@turf/area";
import length from "@turf/length";
import booleanValid from "@turf/boolean-valid";
import kinks from "@turf/kinks";
import type { Feature, Geometry, Polygon } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { imageBounds, plots, type Plot } from "./digital-plot-model";
import { fieldBounds } from "./digital-plot-field";
const editBounds = [Math.min(fieldBounds[0], imageBounds[0]), Math.min(fieldBounds[1], imageBounds[1]), Math.max(fieldBounds[2], imageBounds[2]), Math.max(fieldBounds[3], imageBounds[3])];

export function geometryMeasure(feature: Feature<Geometry>) {
  if (feature.geometry.type === "Polygon") return `${(area(feature) / 10000).toFixed(3)} ha · ${(length({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: feature.geometry.coordinates[0] } }, { units: "kilometers" }) * 1000).toFixed(1)} m 周长`;
  if (feature.geometry.type === "LineString") return `${(length(feature, { units: "kilometers" }) * 1000).toFixed(1)} m`;
  return "";
}
export type ParcelOverrides = Record<string, number[][]>;
export const parcelStorageKey = "ecocloud:digital-plot:hongliulin:demo-boundaries:v1";
export function validParcelRing(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length < 4 || value.length > 200) return false;
  if (!value.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= editBounds[0] - 1e-8 && p[0] <= editBounds[2] + 1e-8 && p[1] >= editBounds[1] - 1e-8 && p[1] <= editBounds[3] + 1e-8)) return false;
  if (value[0][0] !== value.at(-1)[0] || value[0][1] !== value.at(-1)[1]) return false;
  const polygon: Polygon = { type: "Polygon", coordinates: [value] };
  return booleanValid(polygon) && area(polygon) > 1 && kinks(polygon).features.length === 0;
}
export function parseParcelOverrides(raw: string | null): ParcelOverrides {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, ring]) => plots.some(p => p.id === id) && validParcelRing(ring)));
  } catch { return {}; }
}
export function applyParcelOverrides(overrides: ParcelOverrides): Plot[] {
  return plots.map(p => {
    const ring = overrides[p.id]; if (!ring) return p;
    const points = ring.slice(0, -1);
    return { ...p, coordinates: ring.map(q => [q[0], q[1]] as [number, number]), center: [points.reduce((v, q) => v + q[0], 0) / points.length, points.reduce((v, q) => v + q[1], 0) / points.length] as [number, number], area: area({ type: "Polygon", coordinates: [ring] }) / 10000 };
  });
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
