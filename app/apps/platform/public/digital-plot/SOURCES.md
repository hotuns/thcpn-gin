# Digital plot demonstration imagery

- Title: forest
- Provider: BSU / Open Imagery Network contributors
- Source: https://api.openaerialmap.org/meta?title=forest
- Record: https://map.openaerialmap.org/#/25/53.879/15/5ff2fc9a9ef28c00068659a5
- Original thumbnail: https://oin-hotosm-temp.s3.amazonaws.com/5ff2fc9a9ef28c00068659a4/0/5ff2fc9a9ef28c00068659a5.png
- Acquisition: 2020-08-17T21:00:00Z
- Sensor: Phantom 4 Pro; reported resolution approximately 6.2 cm/pixel (thumbnail is lower resolution).
- License: CC BY 4.0 https://creativecommons.org/licenses/by/4.0/
- License documentation: https://openaerialmap.org/about/

The downloaded PNG is unchanged. Simulated flight comparison applies runtime
color rendering only. The Qingshan site name, parcels, station positions,
measurements and 2026 flight dates are fictional. No claim is made that these
are real repeat surveys, measured interpolation, or data from a Chinese site.

The digital-plot central scene uses Three.js meshes with geographically
registered UV coordinates for this local image and the simulated IDW field.
It does not request satellite tiles or real DEM terrain. Extrusion depth is
illustrative, not measured elevation. Generic Atlas templates retain their
separate MapLibre basemaps.

The adapted renderer/effects derive from three-scope-map-skill by 宋夏天Dazzle
(公众号：送你整个夏天), GPL-3.0-or-later. See ../licenses/three-scope-map/NOTICE
and ../licenses/three-scope-map/LICENSE. This does not change the imagery's
independent CC BY 4.0 license above.
