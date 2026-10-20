// SPDX-License-Identifier: GPL-3.0-or-later
// Based on three-scope-map-skill by 宋夏天Dazzle; modified React parcel renderer.
// 作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { mapTheme } from "./vendor/three-scope-map/mapTheme";
import { createChaseLight, createFlyLine, createSideGradientMaterial } from "./vendor/three-scope-map/effects";
import { demoStations, fieldPixels } from "./digital-plot-field";
import { metricSpecs, orthophoto, plots, reading, type Flight, type PlotMetric } from "./digital-plot-model";
import { parcelBottom, parcelGeometry, parcelOuterContour, parcelTop, projectParcel, shapeForRing } from "./digital-plot-geometry";

export type DigitalPlotMapProps = {
  selected: string; frame: number; metric: PlotMetric; heatmap: boolean;
  boundaries: boolean; stations: boolean; heat: boolean; aerial: boolean;
  opacity: number; flight?: Flight; reset: number; onSelect: (id: string) => void;
};
type SceneState = DigitalPlotMapProps & { tilted: boolean; names: string[]; stationLabel: string };
type Feature = {
  group: THREE.Group; top: THREE.Mesh; overlay: THREE.Mesh; edge: THREE.Line;
  material: THREE.MeshStandardMaterial; edgeMaterial: THREE.LineBasicMaterial;
  label: HTMLButtonElement; value: HTMLElement;
};
type Callbacks = { ready: () => void; imageError: () => void; contextLost: () => void };

/** Owns one WebGL context. Prop updates never rebuild its geometry or camera. */
export class DigitalPlotScene {
  private state: SceneState;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 1, 4000);
  private renderer!: THREE.WebGLRenderer;
  private labels = new CSS2DRenderer();
  private controls!: OrbitControls;
  private observer?: ResizeObserver;
  private features = new Map<string, Feature>();
  private stationObjects = new THREE.Group();
  private flyLines = new THREE.Group();
  private flyMaterials: THREE.ShaderMaterial[] = [];
  private ripples: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private ringDecor = new THREE.Group();
  private boundaries = new THREE.Group();
  private chase!: ReturnType<typeof createChaseLight>;
  private heatMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  private heatTexture?: THREE.DataTexture;
  private imageTexture?: THREE.Texture;
  private imageLoaded = false;
  private animation = 0;
  private disposed = false;
  private hovered = "";
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDown?: { x: number; y: number };
  private reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  private firstFrame = false;
  private lastFrame = 0;
  private startTime = performance.now();

  constructor(private host: HTMLDivElement, initial: SceneState, private callbacks: Callbacks) {
    this.state = initial;
    try {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x03070b, 0);
    this.renderer.domElement.dataset.renderer = "threejs";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(this.renderer.domElement);
    this.labels.domElement.className = "dp-three-label-layer";
    host.append(this.labels.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .08;
    this.controls.minDistance = 360;
    this.controls.maxDistance = 1800;
    this.controls.maxPolarAngle = Math.PI * .43;
    this.controls.target.set(0, 0, 25);
    this.scene.add(new THREE.AmbientLight(mapTheme.ambientLight, 1.65));
    const light = new THREE.DirectionalLight(mapTheme.directionalLight, 2.3);
    light.position.set(120, -240, 420);
    this.scene.add(light);

    for (const plot of plots) {
      const geometry = parcelGeometry(plot);
      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ color: mapTheme.surfaceBase, roughness: .87, metalness: .12, emissive: mapTheme.surfaceEmissive, emissiveIntensity: .35, side: THREE.DoubleSide });
      const top = new THREE.Mesh(geometry.top, material);
      top.position.z = parcelTop;
      top.userData.plotId = plot.id;
      const side = new THREE.Mesh(geometry.side, createSideGradientMaterial(.88));
      const overlay = new THREE.Mesh(geometry.heat, this.heatMaterial);
      overlay.position.z = parcelTop + .3;
      overlay.renderOrder = 8;
      const edgeMaterial = new THREE.LineBasicMaterial({ color: mapTheme.accentSoft, transparent: true, opacity: .55 });
      const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(plot.coordinates.map(p => projectParcel(p, parcelTop + .7))), edgeMaterial);
      const label = document.createElement("button");
      label.type = "button";
      label.className = "dp-three-label";
      const name = document.createElement("strong");
      name.textContent = plot.id;
      const value = document.createElement("small");
      label.append(name, value);
      label.onclick = () => this.state.onSelect(plot.id);
      const labelObject = new CSS2DObject(label);
      labelObject.position.copy(projectParcel(plot.center, parcelTop + 6));
      group.add(top, side, overlay, edge, labelObject);
      this.features.set(plot.id, { group, top, overlay, edge, material, edgeMaterial, label, value });
      this.scene.add(group);
    }

    const outerContour = parcelOuterContour();
    this.chase = createChaseLight(outerContour.slice(0, -1).map(p => projectParcel(p, parcelTop + 1.2)));
    this.boundaries.add(this.chase.mesh);
    for (const z of [parcelTop + .5, parcelBottom]) {
      this.boundaries.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outerContour.map(p => projectParcel(p, z))), new THREE.LineBasicMaterial({ color: mapTheme.accentSoft, transparent: true, opacity: z === parcelBottom ? .3 : .7 })));
    }
    this.scene.add(this.boundaries);
    this.createBase(outerContour);
    this.createStations();
    this.scene.add(this.stationObjects, this.flyLines, this.ringDecor);

    this.imageTexture = new THREE.TextureLoader().load(orthophoto, texture => {
      if (this.disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
      this.imageLoaded = true;
      this.updateImage();
    }, undefined, () => { if (!this.disposed) callbacks.imageError(); });
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("pointerleave", this.onPointerLeave);
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    this.update(initial);
    this.fit();
    this.animation = requestAnimationFrame(this.animate);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private createBase(contour: number[][]) {
    const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeForRing(contour), { depth: 8, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: mapTheme.mapBase, roughness: .9, metalness: .3 }));
    base.position.z = parcelBottom - 10;
    this.scene.add(base);
    const grid = new THREE.GridHelper(1100, 44, mapTheme.baseLine, mapTheme.baseLine);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 2;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = .25;
    this.scene.add(grid);
    // Reference HUD ring remains below the geographic geometry, not over its imagery.
    for (const radius of [270, 340]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 1.7, 160), new THREE.MeshBasicMaterial({ color: mapTheme.accent, transparent: true, opacity: .15, side: THREE.DoubleSide, depthWrite: false }));
      ring.position.z = 5;
      this.ringDecor.add(ring);
    }
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * 328, Math.sin(a) * 328, 5), new THREE.Vector3(Math.cos(a) * (i % 6 === 0 ? 340 : 333), Math.sin(a) * (i % 6 === 0 ? 340 : 333), 5));
    }
    this.ringDecor.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: mapTheme.ringDim, transparent: true, opacity: .35 })));
  }

  private createStations() {
    const source = projectParcel(demoStations[2].coordinate, 68);
    for (const [index, station] of demoStations.entries()) {
      const stationGroup = new THREE.Group();
      stationGroup.userData.plotId = station.plot.id;
      stationGroup.position.copy(projectParcel(station.coordinate, parcelTop + 1));
      const metal = new THREE.MeshStandardMaterial({ color: mapTheme.labelText, metalness: .5, roughness: .4 });
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(.7, .85, 19, 8), metal);
      mast.rotation.x = Math.PI / 2;
      mast.position.z = 9.5;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(8, 5, .7), new THREE.MeshStandardMaterial({ color: mapTheme.accent, metalness: .35, roughness: .5 }));
      panel.position.set(0, 0, 12);
      panel.rotation.x = .3;
      const sensor = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 8), new THREE.MeshBasicMaterial({ color: mapTheme.flyHead }));
      sensor.position.z = 20;
      const ripple = new THREE.Mesh(new THREE.RingGeometry(3, 3.7, 48), new THREE.MeshBasicMaterial({ color: mapTheme.accent, transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false }));
      ripple.position.z = .8;
      ripple.userData.phase = index / demoStations.length;
      this.ripples.push(ripple);
      const element = document.createElement("button");
      element.type = "button";
      element.className = "dp-three-station";
      element.textContent = station.id;
      element.onclick = () => this.state.onSelect(station.plot.id);
      element.dataset.station = station.id;
      element.setAttribute("aria-label", `${this.state.stationLabel} ${station.id} · ${station.plot.id}`);
      const label = new CSS2DObject(element);
      label.position.set(0, 0, 26);
      stationGroup.add(mast, panel, sensor, ripple, label);
      this.stationObjects.add(stationGroup);
      if (index !== 2) {
        const { line, material } = createFlyLine(source, projectParcel(station.coordinate, 68), index * .047);
        this.flyLines.add(line);
        this.flyMaterials.push(material);
      }
    }
  }

  private updateImage() {
    const show = this.state.aerial && this.state.flight && this.imageLoaded;
    for (const feature of this.features.values()) {
      const nextMap = show ? this.imageTexture! : null;
      if (feature.material.map !== nextMap) {
        feature.material.map = nextMap;
        feature.material.needsUpdate = true;
      }
      feature.material.color.set(show ? "#a7b8a0" : mapTheme.surfaceBase);
      if (show) feature.material.color.multiplyScalar(this.state.flight!.brightness);
    }
  }

  update(state: SceneState) {
    if (this.disposed) return;
    const previous = this.state;
    this.state = state;
    if (!this.heatTexture || previous.frame !== state.frame || previous.metric !== state.metric || previous.heatmap !== state.heatmap) {
      const pixels = fieldPixels(state.frame, state.metric, state.heatmap);
      if (this.heatTexture) {
        (this.heatTexture.image.data as Uint8Array).set(pixels);
        this.heatTexture.needsUpdate = true;
      } else {
      const texture = new THREE.DataTexture(new Uint8Array(pixels), 240, 168);
      texture.flipY = true;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      this.heatMaterial.map = texture;
      this.heatMaterial.needsUpdate = true;
      this.heatTexture = texture;
      }
    }
    this.heatMaterial.opacity = state.opacity / 100 * .8;
    const spec = metricSpecs[state.metric];
    plots.forEach(plot => {
      const feature = this.features.get(plot.id)!;
      feature.overlay.visible = state.heat;
      feature.edge.visible = state.boundaries || state.selected === plot.id;
      feature.label.setAttribute("aria-pressed", String(state.selected === plot.id));
      feature.label.setAttribute("aria-label", plot.id);
      feature.label.title = `${plot.id} · ${state.names[plot.index]}`;
      feature.value.textContent = `${reading(plot.index, state.frame, state.metric).toFixed(spec.digits)}${spec.unit}`;
      feature.label.classList.toggle("is-selected", state.selected === plot.id);
    });
    this.stationObjects.visible = state.stations;
    this.flyLines.visible = state.stations;
    this.stationObjects.traverse(object => {
      if (!(object instanceof CSS2DObject)) return;
      const element = object.element;
      const station = demoStations.find(item => item.id === element.dataset.station)!;
      element.setAttribute("aria-label", `${state.stationLabel} ${station.id} · ${station.plot.id}`);
    });
    this.boundaries.visible = state.boundaries;
    this.controls.enableRotate = state.tilted;
    this.updateImage();
    if (previous.tilted !== state.tilted || previous.reset !== state.reset) this.fit();
  }

  private fit() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    const usableWidth = Math.max(width * .45, width - 650);
    const distance = Math.max(540, 225 / (Math.tan(THREE.MathUtils.degToRad(21)) * usableWidth / Math.max(1, height)));
    const target = new THREE.Vector3(0, 0, 25);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3(this.state.tilted ? .2 : 0, this.state.tilted ? -.92 : -.001, 1).normalize().multiplyScalar(distance));
    this.camera.lookAt(target);
    this.controls.update();
  }
  private resize = () => {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height || this.disposed) return;
    this.renderer.setSize(width, height);
    this.labels.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };
  private pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects([...this.features.values()].map(feature => feature.top), false)[0]?.object.userData.plotId as string | undefined;
  }
  private onPointerMove = (event: PointerEvent) => {
    this.hovered = this.pick(event) ?? "";
    this.renderer.domElement.style.cursor = this.hovered ? "pointer" : "grab";
  };
  private onPointerDown = (event: PointerEvent) => { this.pointerDown = { x: event.clientX, y: event.clientY }; };
  private onPointerUp = (event: PointerEvent) => {
    if (this.pointerDown && Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) < 5) {
      const id = this.pick(event);
      if (id) this.state.onSelect(id);
    }
    this.pointerDown = undefined;
  };
  private onPointerLeave = () => { this.hovered = ""; this.pointerDown = undefined; };
  private onContextLost = (event: Event) => { event.preventDefault(); this.callbacks.contextLost(); cancelAnimationFrame(this.animation); };
  private onVisibility = () => {
    cancelAnimationFrame(this.animation);
    if (!document.hidden && !this.disposed) this.animation = requestAnimationFrame(this.animate);
  };
  private animate = (now: number) => {
    if (this.disposed || document.hidden) return;
    this.animation = requestAnimationFrame(this.animate);
    if (now - this.lastFrame < 1000 / 30) return;
    this.lastFrame = now;
    const time = this.reducedMotion ? 0 : (now - this.startTime) / 1000;
    for (const [id, feature] of this.features) {
      const active = id === this.state.selected || id === this.hovered;
      feature.group.position.z = this.reducedMotion ? (active ? 7 : 0) : THREE.MathUtils.lerp(feature.group.position.z, active ? 7 : 0, .2);
      feature.edgeMaterial.opacity = active ? 1 : .45;
      feature.material.emissiveIntensity = active ? .8 : .35;
      const scale = THREE.MathUtils.clamp(900 / this.camera.position.distanceTo(this.controls.target), .78, 1.08);
      feature.label.style.width = `${68 * scale}px`;
      feature.label.style.height = `${41 * scale}px`;
      feature.label.style.fontSize = `${11 * scale}px`;
    }
    this.stationObjects.children.forEach(station => {
      station.position.z = parcelTop + 1 + (this.features.get(station.userData.plotId)?.group.position.z ?? 0);
    });
    this.chase.update(time);
    this.ringDecor.rotation.z = time * .012;
    this.flyMaterials.forEach(material => { material.uniforms.uTime.value = time; });
    this.ripples.forEach(ripple => {
      const progress = (time * .5 + ripple.userData.phase) % 1;
      ripple.scale.setScalar(1 + progress * 3);
      ripple.material.opacity = .6 * (1 - progress);
    });
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.host.dataset.triangles = String(this.renderer.info.render.triangles);
    this.host.dataset.drawCalls = String(this.renderer.info.render.calls);
    if (!this.firstFrame && this.host.clientWidth > 0 && this.host.clientHeight > 0) {
      this.firstFrame = true;
      this.callbacks.ready();
    }
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.observer?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    const canvas = this.renderer?.domElement;
    if (canvas) {
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    }
    this.controls?.dispose();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
      if (object instanceof CSS2DObject) object.element.remove();
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    if (!materials.has(this.heatMaterial)) this.heatMaterial.dispose();
    this.heatTexture?.dispose();
    this.imageTexture?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    canvas?.remove();
    this.labels.domElement.remove();
    this.scene.clear();
  }
}
