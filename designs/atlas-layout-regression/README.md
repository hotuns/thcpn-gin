# Atlas trend height regression

Reproduced on the logged-in technology view at 1486 × 954:
the analysis frame was 239.9 px tall, while its portal content was 360 px tall.
The scrolled content began 130 px above its frame, hiding the title/header and
moving the viewport-sized DataV outline through the chart cards. The inspector
had the same frame/scroll coupling.

Fix: keep frames stationary; scroll only inner business content. Give the trend
region a 300 px minimum and flex its charts into the available card height;
extra rows and tables scroll inside the content grid.

`check-layout.js` is a read-only DOM geometry regression probe, not a jsdom CSS
test (jsdom does not lay out elements). In the CUA browser session run:

```js
await liveAtlas.playwright.evaluate(await screenshotFs.readFile(
  '/Users/hotuns/code/thcpn-gin/designs/atlas-layout-regression/check-layout.js', 'utf8'));
```

The initial equivalent top/bottom containment probe returned false. Verify this
probe with two selected metrics, then toggle one card to its data table and back.
Keep `fixed.jpg` as the actual-browser proof; no production API was changed.
