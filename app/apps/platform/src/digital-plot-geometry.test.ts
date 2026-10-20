import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { imageBounds, plots } from "./digital-plot-model";
import { parcelBottom, parcelGeometry, parcelOuterContour, parcelTop, parcelUV, projectParcel } from "./digital-plot-geometry";
import { createChaseLight, createFlyLine, createSideGradientMaterial } from "./vendor/three-scope-map/effects";

describe("Three.js synthetic parcels", () => {
  it("builds all eight surfaces with finite UVs and 20-unit walls", () => {
    expect(plots).toHaveLength(8);
    for (const plot of plots) {
      const geometry = parcelGeometry(plot);
      for (const item of Object.values(geometry)) {
        expect(Array.from(item.getAttribute("position").array).every(Number.isFinite)).toBe(true);
        expect(item.index!.count).toBeGreaterThan(0);
      }
      expect(Array.from(geometry.top.getAttribute("uv").array).every(Number.isFinite)).toBe(true);
      // Mock parcels can extend beyond the ortho bounds; the field covers all parcels.
      const heatUV = Array.from(geometry.heat.getAttribute("uv").array);
      expect(heatUV.every(value => value >= -1e-6 && value <= 1 + 1e-6)).toBe(true);
      geometry.side.computeBoundingBox();
      expect(geometry.side.boundingBox!.min.z).toBe(parcelBottom);
      expect(geometry.side.boundingBox!.max.z).toBe(parcelTop);
      Object.values(geometry).forEach(item => item.dispose());
    }
    expect(parcelTop - parcelBottom).toBe(20);
  });

  it("registers image southwest and northeast corners without mirroring", () => {
    const southwest = projectParcel(imageBounds.slice(0, 2));
    const northeast = projectParcel(imageBounds.slice(2));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([...southwest.toArray(), ...northeast.toArray()], 3));
    parcelUV(geometry, imageBounds);
    const uv = geometry.getAttribute("uv");
    expect(uv.getX(0)).toBeCloseTo(0);
    expect(uv.getY(0)).toBeCloseTo(0);
    expect(uv.getX(1)).toBeCloseTo(1);
    expect(uv.getY(1)).toBeCloseTo(1);
    geometry.dispose();
  });

  it("chases only the closed exterior, removing shared parcel seams", () => {
    const contour = parcelOuterContour();
    expect(contour[0]).toEqual(contour.at(-1));
    const key = (a: number[], b: number[]) => [a.join(","), b.join(",")].sort().join("|");
    const counts = new Map<string, number>();
    plots.forEach(plot => plot.coordinates.slice(0, -1).forEach((point, i) => {
      const id = key(point, plot.coordinates[i + 1]);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }));
    expect(contour.length - 1).toBe([...counts.values()].filter(count => count === 1).length);
    contour.slice(0, -1).forEach((point, i) => expect(counts.get(key(point, contour[i + 1]))).toBe(1));
    const chase = createChaseLight(contour.slice(0, -1).map(point => projectParcel(point)));
    chase.update(42);
    const alpha = Array.from(chase.mesh.geometry.getAttribute("alpha").array);
    expect(alpha.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(alpha.some(value => value > 0)).toBe(true);
    const position = chase.mesh.geometry.getAttribute("position");
    expect(Array.from(chase.mesh.geometry.index!.array).every(index => index < position.count)).toBe(true);
    expect(chase.mesh.material.depthWrite).toBe(false);
    chase.mesh.geometry.dispose();
    chase.mesh.material.dispose();
  });

  it("keeps fly-line ends registered and side gradient bounded", () => {
    const from = new Vector3(0, 0, 68), to = new Vector3(100, 100, 68);
    const { line, material } = createFlyLine(from, to, .2);
    const positions = line.geometry.getAttribute("position");
    expect(new Vector3().fromBufferAttribute(positions, 0)).toEqual(from);
    expect(new Vector3().fromBufferAttribute(positions, positions.count - 1)).toEqual(to);
    expect(positions.getZ(44)).toBeGreaterThan(68);
    const side = createSideGradientMaterial();
    expect(side.uniforms.topZ.value).toBe(parcelTop);
    expect(side.uniforms.bottomZ.value).toBe(parcelBottom);
    line.geometry.dispose(); material.dispose(); side.dispose();
  });
});
