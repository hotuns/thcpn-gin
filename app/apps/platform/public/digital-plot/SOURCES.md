# Digital plot demonstration imagery

## Active imagery: 红柳林 / Hongliulin

- Provider: project user; user-supplied UAV orthophoto.
- Catalog: https://tiles-map.oss-cn-beijing.aliyuncs.com/datalist.json
- XYZ tiles: https://tiles-map.oss-cn-beijing.aliyuncs.com/%E9%9D%92%E6%B5%B7/%E7%BA%A2%E6%9F%B3%E6%9E%97/{z}/{x}/{y}.png
- Catalog `create_time`: 2023-04-24. This is not a verified capture date.
- Catalog center: 94.4616322074428, 38.03324762305709.
- Capture resolution and coordinate datum: unspecified in catalog.
- No independent open redistribution license supplied; do not apply the previous OAM asset's CC BY license to this imagery.

`hongliulin-preview.jpg` is a 1280 × 1024 mosaic of 20 opaque 256px tiles:
zoom 18, x=199854..199858, y=101083..101086. Its geographic bounds are derived
from XYZ Web Mercator tile indices in `digital-plot-imagery.ts`. This window
is an illustration area, not the full survey footprint or a surveyed boundary.
Regenerate using `scripts/prepare-hongliulin-preview.py` with Python and Pillow.

The Three.js scene loads this bounded tile mosaic and uses the matching local
preview if online imagery fails. MapLibre editing/comparison uses online tiles
with the same local fallback. Both retain geographic registration. Parcels,
station positions, metrics (including NDVI), interpolation, links and 2026
flight dates are fictional. Flight comparison reuses the same imagery with
rendering differences; it does not show real historical change. Extrusion is
illustrative, not measured elevation. No customer device data is accessed.

Renderer/effects derive from three-scope-map-skill by 宋夏天Dazzle
(公众号：送你整个夏天), GPL-3.0-or-later. See ../licenses/three-scope-map/NOTICE
and ../licenses/three-scope-map/LICENSE. Code and imagery licenses are separate.

## Retained legacy asset (not used by the Hongliulin showcase)


- Title: forest
- Provider: BSU / Open Imagery Network contributors
- Source: https://api.openaerialmap.org/meta?title=forest
- Record: https://map.openaerialmap.org/#/25/53.879/15/5ff2fc9a9ef28c00068659a5
- Original thumbnail: https://oin-hotosm-temp.s3.amazonaws.com/5ff2fc9a9ef28c00068659a4/0/5ff2fc9a9ef28c00068659a5.png
- Acquisition: 2020-08-17T21:00:00Z
- Sensor: Phantom 4 Pro; reported resolution approximately 6.2 cm/pixel (thumbnail is lower resolution).
- License: CC BY 4.0 https://creativecommons.org/licenses/by/4.0/
- License documentation: https://openaerialmap.org/about/

`forest-orthophoto.png` remains unchanged for provenance; it is no longer
used by the digital-plot page or the Atlas topic thumbnail.
