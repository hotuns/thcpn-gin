import area from "@turf/area";
import { hongliulin, hongliulinBounds } from "./digital-plot-imagery";
// A deliberately isolated fixture model: never mixed with workspace telemetry.
export type PlotMetric = "moisture" | "temperature" | "rainfall" | "ndvi";
export const metricSpecs: Record<
  PlotMetric,
  { unit: string; min: number; max: number; digits: number }
> = {
  moisture: { unit: "%", min: 15, max: 35, digits: 1 },
  temperature: { unit: "°C", min: 12, max: 30, digits: 1 },
  rainfall: { unit: "mm", min: 0, max: 25, digits: 1 },
  ndvi: { unit: "", min: 0.4, max: 0.9, digits: 2 },
};
export const metrics = Object.keys(metricSpecs) as PlotMetric[];
export const firstHour = Date.parse("2026-10-02T00:00:00+08:00");
export const lastFrame = 6 * 24 + 14;
export const imageBounds = hongliulinBounds;
export const orthophoto = hongliulin.preview;
export const aerialTiles = hongliulin.tiles;
export const flights = [
  {
    id: "flight-1",
    frame: 10,
    date: "2026-10-02",
    saturation: -0.35,
    brightness: 0.76,
  },
  {
    id: "flight-2",
    frame: 34,
    date: "2026-10-03",
    saturation: -0.12,
    brightness: 0.86,
  },
  {
    id: "flight-3",
    frame: 106,
    date: "2026-10-06",
    saturation: 0.12,
    brightness: 1,
  },
] as const;
export type Flight = (typeof flights)[number];
export function flightAt(frame: number): Flight | undefined {
  return [...flights].reverse().find((flight) => flight.frame <= frame);
}
export function frameDate(frame: number) {
  return new Date(firstHour + frame * 3600000);
}
export function dateFrame(value: string) {
  const parsed = Date.parse(`${value}:00+08:00`);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(
    0,
    Math.min(lastFrame, Math.round((parsed - firstHour) / 3600000)),
  );
}
export function inputDate(frame: number) {
  return new Date(frameDate(frame).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 16);
}
export function advanceFrame(frame: number) {
  return Math.min(lastFrame, frame + 1);
}
export function coordinate(x: number, y: number): [number, number] {
  return [
    imageBounds[0] +
      (x / 100) * (imageBounds[2] - imageBounds[0]),
    imageBounds[3] - (y / 100) * (imageBounds[3] - imageBounds[1]),
  ];
}
const rings = [
  [
    [23, 19],
    [38, 14],
    [45, 22],
    [43, 34],
    [31, 38],
    [19, 30],
  ],
  [
    [45, 22],
    [61, 20],
    [72, 29],
    [65, 39],
    [54, 38],
    [43, 34],
  ],
  [
    [43, 34],
    [54, 38],
    [65, 39],
    [63, 51],
    [50, 56],
    [39, 48],
    [31, 38],
  ],
  [
    [72, 29],
    [82, 37],
    [84, 49],
    [76, 56],
    [63, 51],
    [65, 39],
  ],
  [
    [19, 30],
    [31, 38],
    [39, 48],
    [33, 60],
    [19, 54],
    [14, 43],
  ],
  [
    [19, 54],
    [33, 60],
    [36, 72],
    [28, 79],
    [17, 68],
  ],
  [
    [39, 48],
    [50, 56],
    [63, 51],
    [66, 68],
    [52, 79],
    [36, 72],
    [33, 60],
  ],
  [
    [63, 51],
    [76, 56],
    [80, 72],
    [67, 86],
    [52, 79],
    [66, 68],
  ],
];
export const plots = rings.map((ring, i) => {
  const coordinates = [...ring, ring[0]].map(([x, y]) => coordinate(x, y));
  return {
    id: `P0${i + 1}`,
    index: i,
    // A geodesic area of a fictional boundary, not a surveyed area.
    area: area({ type: "Polygon", coordinates: [coordinates] }) / 10000,
    station: ![4, 7].includes(i),
    center: coordinate(
      ring.reduce((n, p) => n + p[0], 0) / ring.length,
      ring.reduce((n, p) => n + p[1], 0) / ring.length,
    ),
    coordinates,
  };
});
export type Plot = (typeof plots)[number];
export function containsPoint(plot: Plot, lng: number, lat: number) {
  let inside = false;
  for (
    let i = 0, j = plot.coordinates.length - 1;
    i < plot.coordinates.length;
    j = i++
  ) {
    const [x, y] = plot.coordinates[i];
    const [px, py] = plot.coordinates[j];
    if (y > lat !== py > lat && lng < ((px - x) * (lat - y)) / (py - y) + x)
      inside = !inside;
  }
  return inside;
}
export function reading(index: number, frame: number, metric: PlotMetric) {
  const hour = frame % 24;
  const wave = Math.sin(frame / 19 + index * 0.8);
  const values = {
    moisture: 24 + Math.sin(index * 1.8) * 5 + wave * 3 + frame / 80,
    temperature:
      20 + Math.sin(((hour - 8) / 24) * Math.PI * 2) * 5 - index * 0.25 + wave,
    rainfall: Math.max(0, 10 + wave * 9 + Math.sin(index) * 4),
    ndvi: 0.68 + Math.sin(index) * 0.1 + Math.sin(frame / 80) * 0.05,
  };
  return Number(values[metric].toFixed(metricSpecs[metric].digits));
}
export function metricColor(value: number, metric: PlotMetric) {
  return `rgb(${metricRGB(value, metric).join(",")})`;
}
export function metricRGB(value: number, metric: PlotMetric) {
  const { min, max } = metricSpecs[metric];
  const n = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const stops = [
    [0, 112, 235],
    [38, 208, 220],
    [110, 214, 127],
    [239, 211, 79],
    [239, 114, 43],
  ];
  const index = Math.min(stops.length - 2, Math.floor(n * (stops.length - 1)));
  const f = n * (stops.length - 1) - index;
  return stops[index].map((v, i) =>
    Math.round(v + (stops[index + 1][i] - v) * f),
  );
}
export function plotFeatures(frame: number, metric: PlotMetric) {
  return {
    type: "FeatureCollection" as const,
    features: plots.map((plot) => ({
      type: "Feature" as const,
      properties: {
        id: plot.id,
        color: metricColor(reading(plot.index, frame, metric), metric),
      },
      geometry: { type: "Polygon" as const, coordinates: [plot.coordinates] },
    })),
  };
}
