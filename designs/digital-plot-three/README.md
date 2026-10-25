# Digital plot — Three.js verification

Scope: React terminal synthetic parcel scene, not an Earth/province-map migration.
Source: three-scope-map-skill by 宋夏天Dazzle (公众号：送你整个夏天),
GPL-3.0-or-later. Original license/notice and unmodified theme are retained under
`app/apps/platform/src/vendor/three-scope-map/`.

## Adaptation

- Reused reference side-gradient shader, safe independent-quad chase ribbon,
  fly-line concept, OrbitControls, CSS2D labels and ecological theme.
- Eight mock extruded parcel meshes; six station towers, ripples and demo links.
- Selected/hovered parcel surface and walls lift together; its station follows.
- Registered orthophoto and IDW DataTexture share geographic coordinates;
  history changes reuse texture storage and geometry.
- No screenshot/SVG fallback, transparent full-map texture plane, real DEM,
  administrative drilldown or Earth intro. Existing two generic maps unchanged.
- One context per mount, capped pixel ratio/30 fps, hidden-tab pause,
  ResizeObserver and explicit GPU/DOM/listener cleanup.

## Verification (2026-10-18)

- Logged-in local browser, 1920 × 1080 desktop.
- Real WebGL canvas observed: 5,729 triangles; 69 draw calls in inspected state.
- Parcel label selection updates directory, detail title and values.
- Metric and previous-hour changes update labels, legend and history chart.
- Aerial and heat switches independently show image/field layers.
- Perspective / plan toggle and fit-all verified visually.
- TypeScript check and platform production build pass.
- All frontend tests: 215 tests / 60 files pass; new geometry/effect tests and
  React lifecycle/error/retry tests included. Production Three.js chunk remains
  route-lazy (~144 kB gzip); Vite reports its normal large-chunk warning.
- Bundled template integrity: 31 files passed.
- Upstream strict checker: common WebGL/extrusion/outer-contour/chase/fly-line/
  hover/control/privacy checks pass. Overall command exits 1 because it requires
  Vue, Earth/China components, administrative GeoJSON and Earth textures. Those
  requirements do not apply to this React parcel scope. Vite is a workspace-root
  dependency. No unused Vue/Earth files were added to silence these blockers.

The orthophoto is a public 2020 thumbnail, not a real 2026 repeat survey. Parcel
positions, station data, flights and extrusion depth are illustrative.
