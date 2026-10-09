import {
  containsPoint,
  metricRGB,
  plots,
  reading,
  type PlotMetric,
} from "./digital-plot-model";

// Only the six synthetic stations drive this demonstration field. This is not
// interpolation of customer observations and must remain labelled as simulated.
export const demoStations = plots
  .filter((p) => p.station)
  .map((p, i) => ({
    id: `S${String(i + 1).padStart(2, "0")}`,
    plot: p,
    coordinate: [p.center[0] - 0.0011, p.center[1] + 0.0007] as [
      number,
      number,
    ],
  }));
const coordinates = plots.flatMap((p) => p.coordinates);
export const fieldBounds = [
  Math.min(...coordinates.map((p) => p[0])),
  Math.min(...coordinates.map((p) => p[1])),
  Math.max(...coordinates.map((p) => p[0])),
  Math.max(...coordinates.map((p) => p[1])),
] as const;
export const fieldCorners: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [fieldBounds[0], fieldBounds[3]],
  [fieldBounds[2], fieldBounds[3]],
  [fieldBounds[2], fieldBounds[1]],
  [fieldBounds[0], fieldBounds[1]],
];

export function fieldValue(
  lng: number,
  lat: number,
  frame: number,
  metric: PlotMetric,
) {
  let weighted = 0,
    weights = 0;
  for (const station of demoStations) {
    const dx = (lng - station.coordinate[0]) * Math.cos((lat * Math.PI) / 180);
    const dy = lat - station.coordinate[1];
    const distance = dx * dx + dy * dy;
    const value = reading(station.plot.index, frame, metric);
    if (distance < 1e-14) return value;
    const weight = 1 / distance;
    weighted += weight * value;
    weights += weight;
  }
  return weighted / weights;
}

// Small fixed texture (about 160 KB) avoids per-frame GeoJSON worker rebuilds.
// Native map image layers drape this field onto DEM terrain, not screen-space SVG.
export function fieldPixels(
  frame: number,
  metric: PlotMetric,
  continuous: boolean,
  width = 240,
  height = 168,
) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const lat =
      fieldBounds[3] - ((y + 0.5) / height) * (fieldBounds[3] - fieldBounds[1]);
    for (let x = 0; x < width; x++) {
      const lng =
        fieldBounds[0] +
        ((x + 0.5) / width) * (fieldBounds[2] - fieldBounds[0]);
      const plot = plots.find((p) => containsPoint(p, lng, lat));
      if (!plot) continue;
      const value = continuous
        ? fieldValue(lng, lat, frame, metric)
        : reading(plot.index, frame, metric);
      const offset = (y * width + x) * 4;
      pixels.set([...metricRGB(value, metric), 255], offset);
    }
  }
  return pixels;
}

export function fieldTexture(
  frame: number,
  metric: PlotMetric,
  continuous: boolean,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 168;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D unavailable");
  const image = context.createImageData(canvas.width, canvas.height);
  image.data.set(
    fieldPixels(frame, metric, continuous, canvas.width, canvas.height),
  );
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export function boundaryTexture(selected: string, boundaries: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 840;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  const path = (plot: (typeof plots)[number]) => {
    ctx.beginPath();
    plot.coordinates.forEach(([lng, lat], i) => {
      const x =
        ((lng - fieldBounds[0]) / (fieldBounds[2] - fieldBounds[0])) *
        canvas.width;
      const y =
        ((fieldBounds[3] - lat) / (fieldBounds[3] - fieldBounds[1])) *
        canvas.height;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  if (boundaries) {
    ctx.strokeStyle = "#c3eaff";
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 6]);
    for (const plot of plots) {
      path(plot);
      ctx.stroke();
    }
  }
  const focus = plots.find((p) => p.id === selected);
  if (focus) {
    path(focus);
    ctx.setLineDash([]);
    ctx.shadowColor = "#00cfff";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = "#40dcff";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ddfcff";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}
