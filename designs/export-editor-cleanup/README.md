# Export creation — interaction simplification

Follow-up to the annotated production screenshots, preserving the existing
platform pine palette and shadcn controls. No new design system or assets.

- One continuous form surface replaces nested section/field cards.
- Direct device choices are live values: no expander, Done button, or duplicate
  selected-device list. Search appears above five candidates; filtered select-all
  retains selections outside the filter. Single-device group/carbon choices are
  immediate, too.
- Review column uses the brand-color step badge, a clear top rule and panel
  background; unavailable submit has a concrete reason. The disabled state itself
  is not disguised as enabled.
- Existing payload types, permission boundaries, range validation, gateway node
  defaults and carbon combination rules are unchanged.

`preview.tsx` uses actual production components with isolated synthetic query
cache fixtures. It never creates production jobs; the create method is blocked
inside this standalone preview bundle only. Production authentication is not
bypassed or modified. Run `node designs/export-editor-cleanup/build-preview.mjs`,
then serve `designs/` over HTTP and open `export-editor-cleanup/index.html`.

Verification: standard device selection immediately updates count and enables
submit; gateway selection populates three mock nodes; carbon selection creates
eight mock combinations. Component tests cover selection/deselection, filtered
bulk selection, tag search and single choice. Real submission was not performed.
