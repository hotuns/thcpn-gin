# DataV-React selected components

Source: https://github.com/DataV-Team/DataV-React

Pinned revision: `423998d8ebe6a964db29f2890cfb936d1d8a2e10`.
Original files: `src/components/{borderBox12,borderBox13,decoration5,decoration8,decoration11}/index.js`.
MIT copyright and license are retained in `LICENSE`.
The same notice ships with the application at `/licenses/DataV-React.txt`.

These are source adaptations of DataV components, not a new implementation of
their geometry. The npm release (1.2.5) declares React/ReactDOM ^16.8 peers;
this application uses React 19. Only the components we use are vendored, rather
than forcing incompatible peers or importing its unrelated chart engine.

Local changes: TypeScript prop types; remove runtime PropTypes and heavyweight
clone/merge/color utilities for two fixed palette values; use ResizeObserver
with cleanup; React useId for unique SVG filters. Decorative SVG animations are
disabled: the data and map are the focus, and static geometry remains visible
for reduced-motion users. Upstream component coordinates are retained.
