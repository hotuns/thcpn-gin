# Three Scope Map / digital plot adaptation

Based on three-scope-map-skill by 宋夏天Dazzle.
作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天
Original source: https://github.com/songsummer920-dazzle/three-scope-map-skill

The upstream theme and side-gradient shader are reused; the approved segmented
chase ribbon and fly-line shader are adapted to our terminal **synthetic parcel**
scope. These modified map files retain GPL-3.0-or-later headers, LICENSE, NOTICE
and CITATION. This is not an official release by the original author.

React lifecycle, raycasting, resource cleanup, fixture projection and historical
overlay updates are integrated with this application's existing isolated demo.
No China/province GeoJSON, unrelated terrain texture or Earth intro is copied.
The eight parcels and six stations remain fictional. The image is a georeferenced mosaic of user-supplied Hongliulin XYZ tiles; mesh extrusion is illustrative, not DEM.

This is a React terminal parcel adaptation, not the complete Vue/Earth template.
The upstream strict checker assumes Vue, administrative scope drilldown and an
Earth entrance. Its template-specific checks do not apply; geometry tests,
production compilation and actual WebGL visual verification cover this route.

Review GPL obligations before distributing the derived frontend. This addition
does not change the license declaration of unrelated backend modules.
