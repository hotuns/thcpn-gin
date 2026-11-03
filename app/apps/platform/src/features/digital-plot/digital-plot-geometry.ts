// SPDX-License-Identifier: GPL-3.0-or-later
// 作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天
// Parcel adaptation of three-scope-map-skill; synthetic fixture geometry, not a survey.
import * as THREE from "three";
import { imageBounds, plots, type Plot } from "./digital-plot-model";
import { fieldBounds } from "./digital-plot-field";

export const parcelTop = 44;
export const parcelBottom = 24;
const origin = [(imageBounds[0] + imageBounds[2]) / 2, (imageBounds[1] + imageBounds[3]) / 2];
const projectionScale = 500 / ((imageBounds[2] - imageBounds[0]) * Math.cos(origin[1] * Math.PI / 180));
export function projectParcel([lng, lat]: readonly number[], z = parcelTop) {
  return new THREE.Vector3((lng - origin[0]) * Math.cos(origin[1] * Math.PI / 180) * projectionScale, (lat - origin[1]) * projectionScale, z);
}
export function shapeForRing(ring: readonly (readonly number[])[]) {
  const shape = new THREE.Shape();
  ring.forEach((point, index) => {
    const projected = projectParcel(point);
    if (index === 0) shape.moveTo(projected.x, projected.y);
    else shape.lineTo(projected.x, projected.y);
  });
  shape.closePath();
  return shape;
}
export function parcelUV(geometry: THREE.BufferGeometry, bounds: readonly number[]) {
  const min = projectParcel([bounds[0], bounds[1]]);
  const max = projectParcel([bounds[2], bounds[3]]);
  const positions = geometry.getAttribute("position");
  const uv = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index++) {
    uv[index * 2] = (positions.getX(index) - min.x) / (max.x - min.x);
    uv[index * 2 + 1] = (positions.getY(index) - min.y) / (max.y - min.y);
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}
export function parcelGeometry(plot: Plot) {
  const top = parcelUV(new THREE.ShapeGeometry(shapeForRing(plot.coordinates)), imageBounds);
  const heat = parcelUV(top.clone(), fieldBounds);
  const positions: number[] = [];
  const indices: number[] = [];
  // Same independent edge-quad construction as the reference; no folded strips.
  for (let index = 0; index < plot.coordinates.length - 1; index++) {
    const a = plot.coordinates[index], b = plot.coordinates[index + 1];
    const offset = positions.length / 3;
    [projectParcel(a, parcelTop), projectParcel(b, parcelTop), projectParcel(b, parcelBottom), projectParcel(a, parcelBottom)].forEach(point => positions.push(point.x, point.y, point.z));
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  side.setIndex(indices);
  side.computeVertexNormals();
  return { top, heat, side };
}

// Cancel shared edges, then walk the exterior. Never chase internal parcel seams.
export function parcelOuterContour(source: readonly Plot[] = plots) {
  const key = (point: readonly number[]) => point.map(value => value.toFixed(9)).join(":");
  const edges = new Map<string, { a: number[]; b: number[]; count: number }>();
  for (const plot of source) for (let i = 0; i < plot.coordinates.length - 1; i++) {
    const a = plot.coordinates[i], b = plot.coordinates[i + 1];
    const id = [key(a), key(b)].sort().join("|");
    const found = edges.get(id);
    if (found) found.count++;
    else edges.set(id, { a, b, count: 1 });
  }
  const boundary = [...edges.values()].filter(edge => edge.count === 1);
  if (!boundary.length) return [];
  const ring = [boundary[0].a, boundary[0].b];
  boundary.splice(0, 1);
  while (boundary.length && key(ring.at(-1)!) !== key(ring[0])) {
    const index = boundary.findIndex(edge => key(edge.a) === key(ring.at(-1)!) || key(edge.b) === key(ring.at(-1)!));
    if (index < 0) throw new Error("Disconnected synthetic parcel boundary");
    const edge = boundary.splice(index, 1)[0];
    ring.push(key(edge.a) === key(ring.at(-1)!) ? edge.b : edge.a);
  }
  if (boundary.length || key(ring.at(-1)!) !== key(ring[0])) throw new Error("Open synthetic parcel boundary");
  return ring;
}
