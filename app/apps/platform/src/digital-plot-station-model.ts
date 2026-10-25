// SPDX-License-Identifier: GPL-3.0-or-later
// 作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天
// Additional synthetic weather-station geometry for the existing parcel renderer.
import * as THREE from "three";
import { mapTheme } from "./vendor/three-scope-map/mapTheme";

export function weatherStationModel() {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: mapTheme.labelText, metalness: .65, roughness: .35 });
  const dark = new THREE.MeshStandardMaterial({ color: mapTheme.mapBase, metalness: .3, roughness: .6 });
  const blue = new THREE.MeshStandardMaterial({ color: mapTheme.accent, metalness: .4, roughness: .35, emissive: mapTheme.accent, emissiveIntensity: .18 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); group.add(mesh); return mesh; };
  add(new THREE.BoxGeometry(9, 9, 1.5), dark, 0, 0, 1);
  const mast = add(new THREE.CylinderGeometry(.65, .95, 28, 10), metal, 0, 0, 15); mast.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * 5, Math.sin(a) * 5, 1), q = new THREE.Vector3(0, 0, 12);
    const leg = add(new THREE.CylinderGeometry(.3, .3, p.distanceTo(q), 6), metal, (p.x + q.x) / 2, (p.y + q.y) / 2, 6.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.sub(p).normalize());
  }
  const solar = add(new THREE.BoxGeometry(10, 7, .5), blue, 5, 0, 14); solar.rotation.y = -.5;
  for (let i = -1; i <= 1; i++) add(new THREE.BoxGeometry(.12, 7, .15), metal, 5 + i * 2.7, 0, 14.6);
  add(new THREE.BoxGeometry(4, 3, 6), dark, -2, 0, 9);
  // Radiation shield: separated louvres rather than a featureless sphere.
  for (let i = 0; i < 5; i++) { const disk = add(new THREE.CylinderGeometry(2.7, 2.7, .45, 16), metal, -4, 0, 16 + i * .8); disk.rotation.x = Math.PI / 2; }
  add(new THREE.BoxGeometry(14, .6, .6), metal, 0, 0, 25);
  const turbine = new THREE.Group(); turbine.position.set(6, 0, 28);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(5, .3, .3), metal); arm.position.set(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 0); arm.rotation.z = a;
    const cup = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 6, 0, Math.PI), blue); cup.position.set(Math.cos(a) * 5, Math.sin(a) * 5, 0); cup.rotation.z = a;
    turbine.add(arm, cup);
  }
  group.add(turbine);
  return { group, turbine };
}
