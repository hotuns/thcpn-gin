// SPDX-License-Identifier: GPL-3.0-or-later
// Based on three-scope-map-skill by 宋夏天Dazzle; modified for the React parcel scene.
// 作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天
// Source: https://github.com/songsummer920-dazzle/three-scope-map-skill
import * as THREE from "three";
import { mapTheme } from "./mapTheme";

/** Approved narrow independent-quads ribbon; one exterior loop, one alpha tail. */
export function createChaseLight(input: THREE.Vector3[]) {
  let loop = input;
  for (let iteration = 0; iteration < 4; iteration++) {
    const next: THREE.Vector3[] = [];
    loop.forEach((point, index) => {
      const following = loop[(index + 1) % loop.length];
      next.push(point.clone().lerp(following, .25), point.clone().lerp(following, .75));
    });
    loop = next;
  }
  const positions: number[] = [], distances: number[] = [], indices: number[] = [];
  let total = 0;
  const ribbonWidth = 2.02, segmentLength = 1.35;
  loop.forEach((start, index) => {
    const end = loop[(index + 1) % loop.length];
    const length = start.distanceTo(end);
    if (length < .01) return;
    const normal = new THREE.Vector3(-(end.y - start.y), end.x - start.x, 0).normalize().multiplyScalar(ribbonWidth / 2);
    const divisions = Math.max(1, Math.ceil(length / segmentLength));
    for (let step = 0; step < divisions; step++) {
      const from = start.clone().lerp(end, step / divisions);
      const to = start.clone().lerp(end, (step + 1) / divisions);
      const offset = positions.length / 3;
      [from.clone().add(normal), from.clone().sub(normal), to.clone().add(normal), to.clone().sub(normal)].forEach(p => positions.push(p.x, p.y, p.z));
      distances.push(total + length * step / divisions, total + length * step / divisions, total + length * (step + 1) / divisions, total + length * (step + 1) / divisions);
      indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
    }
    total += length;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const alpha = new THREE.BufferAttribute(new Float32Array(distances.length), 1);
  geometry.setAttribute("alpha", alpha);
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(mapTheme.chaseLight) } },
    vertexShader: `attribute float alpha; varying float vAlpha; void main(){vAlpha=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 color; varying float vAlpha; void main(){gl_FragColor=vec4(color,vAlpha);}`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 20;
  return { mesh, update(time: number) {
    if (!total) return;
    const head = (time * 230) % total, tail = Math.max(100, total * .07);
    distances.forEach((distance, index) => {
      const behind = (head - distance + total) % total;
      alpha.setX(index, behind > tail ? 0 : Math.pow(1 - behind / tail, 1.65));
    });
    alpha.needsUpdate = true;
  } };
}

/** Adapted reference fly-line shader; arcs are explicitly demo links. */
export function createFlyLine(source: THREE.Vector3, target: THREE.Vector3, delay: number) {
  const middle = source.clone().lerp(target, .5);
  middle.z += Math.max(28, source.distanceTo(target) * .15);
  const points = new THREE.QuadraticBezierCurve3(source, middle, target).getPoints(88);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  geometry.setAttribute("progress", new THREE.Float32BufferAttribute(points.map((_, i) => i / (points.length - 1)), 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uDelay: { value: delay }, uColor: { value: new THREE.Color(mapTheme.flyHead) } },
    vertexShader: `attribute float progress; varying float vProgress; void main(){vProgress=progress;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform float uTime;uniform float uDelay;uniform vec3 uColor;varying float vProgress;void main(){float head=fract(uTime*.3+uDelay);float d=head-vProgress;if(d<0.0)d+=1.0;float body=1.0-smoothstep(0.0,.24,d);float core=1.0-smoothstep(0.0,.035,d);gl_FragColor=vec4(uColor,body*.72+core*.5);}`,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 16;
  return { line, material };
}

export function createSideGradientMaterial(alpha = 0.86, topZ = 44, bottomZ = 24) {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      topColor: { value: new THREE.Color(mapTheme.accent) },
      midColor: { value: new THREE.Color(mapTheme.sideMid) },
      bottomColor: { value: new THREE.Color(mapTheme.sideBottom) },
      alpha: { value: alpha },
      topZ: { value: topZ },
      bottomZ: { value: bottomZ },
    },
    vertexShader: `
      uniform float topZ;
      uniform float bottomZ;
      varying float vDepth;
      void main() {
        vDepth = clamp((position.z - bottomZ) / max(0.001, topZ - bottomZ), 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      uniform float alpha;
      varying float vDepth;
      void main() {
        vec3 lower = mix(bottomColor, midColor, smoothstep(0.0, 0.24, vDepth));
        vec3 color = mix(lower, topColor, smoothstep(0.34, 1.0, vDepth));
        float edgeGlow = smoothstep(0.48, 1.0, vDepth);
        gl_FragColor = vec4(color + edgeGlow * topColor * 0.24, alpha * (0.46 + vDepth * 0.54));
      }
    `,
  });
}
