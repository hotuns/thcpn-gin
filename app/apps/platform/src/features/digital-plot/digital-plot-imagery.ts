// SPDX-License-Identifier: GPL-3.0-or-later
// 作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天
// One bounded preview window, not a surveyed site boundary or a declared CRS.
export const hongliulin = {
  id: "hongliulin",
  catalog: "https://tiles-map.oss-cn-beijing.aliyuncs.com/datalist.json",
  tiles: "https://tiles-map.oss-cn-beijing.aliyuncs.com/%E9%9D%92%E6%B5%B7/%E7%BA%A2%E6%9F%B3%E6%9E%97/{z}/{x}/{y}.png",
  center: [94.4616322074428, 38.03324762305709] as const,
  preview: "/digital-plot/hongliulin-preview.jpg",
  grid: { z: 18, x: 199854, y: 101083, columns: 5, rows: 4, tileSize: 256 },
  minzoom: 12,
  maxzoom: 22,
  attribution: "红柳林 · 用户提供无人机正射影像",
};

export function tileLongitude(x: number, z: number) { return x / 2 ** z * 360 - 180; }
export function tileLatitude(y: number, z: number) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI; }
const { z, x, y, columns, rows } = hongliulin.grid;
export const hongliulinBounds = [tileLongitude(x, z), tileLatitude(y + rows, z), tileLongitude(x + columns, z), tileLatitude(y, z)] as const;

export function imageryTileUrl(x: number, y: number, z = hongliulin.grid.z) {
  return hongliulin.tiles.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Bounded, georeferenced tile mosaic for the existing Three.js parcel meshes. */
export async function loadHongliulinMosaic(signal: AbortSignal) {
  const grid = hongliulin.grid;
  const canvas = document.createElement("canvas");
  canvas.width = grid.columns * grid.tileSize;
  canvas.height = grid.rows * grid.tileSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Imagery canvas unavailable");
  context.fillStyle = "#071b2b";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await Promise.all(Array.from({ length: grid.columns * grid.rows }, async (_, index) => {
    const column = index % grid.columns, row = Math.floor(index / grid.columns);
    const response = await fetch(imageryTileUrl(grid.x + column, grid.y + row), { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
    if (!response.ok) throw new Error(`Imagery tile HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      signal.throwIfAborted();
      context.drawImage(bitmap, column * grid.tileSize, row * grid.tileSize, grid.tileSize, grid.tileSize);
    } finally { bitmap.close(); }
  }));
  return canvas;
}
