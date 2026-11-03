import area from "@turf/area";
import booleanValid from "@turf/boolean-valid";
import kinks from "@turf/kinks";
import type { Polygon } from "geojson";
import { fieldBounds } from "./digital-plot-field";
import { imageBounds, plots, type Plot } from "./digital-plot-model";


const editBounds = [Math.min(fieldBounds[0], imageBounds[0]), Math.min(fieldBounds[1], imageBounds[1]), Math.max(fieldBounds[2], imageBounds[2]), Math.max(fieldBounds[3], imageBounds[3])];
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
