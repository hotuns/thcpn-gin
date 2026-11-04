import { act, useState } from "react";
import { expect, it } from "vitest";
import type { DataStream } from "@thcpn/api";
import { EcoTrendViewer } from "../../apps/platform/src/features/atlas/eco-trend-viewer";
import { render, eventually } from "../render";
const stamp = "2026-11-03T00:00:00Z";
const streams: DataStream[] = [0, 1, 2, 3].map(index => ({ id: `s${index}`, code: `c${index}`, name: `指标${index}`, unit: index === 0 ? "°C" : "%", type: "telemetry", status: "active", device_id: "device", computed: false, created_by: "observer", created_at: stamp, updated_at: stamp }));
function App() {
  const [subset, setSubset] = useState(streams);
  const [focus, setFocus] = useState<string | null>("s3");
  return <><button onClick={() => setSubset(streams.slice(0, 2))}>切换节点</button><EcoTrendViewer streams={subset} results={new Map()} range={{ start: stamp, end: stamp }} focusedId={focus} onFocus={setFocus} /></>;
}
it("resets to the first metric when the new device or node has no previous focused metric", async () => {
  const { host } = await render(<App />);
  expect(host.querySelector(".eco-trend-pager span")?.textContent).toBe("4 / 4");
  const plot = host.querySelector(".eco-trend-plot");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await eventually(() => expect(host.querySelector<HTMLSelectElement>('select[aria-label="趋势指标"]')?.value).toBe("s0"));
  expect(host.querySelector(".eco-trend-pager span")?.textContent).toBe("1 / 2");
  expect(host.querySelector(".eco-section-heading > span")?.textContent).toBe("°C");
  expect(host.querySelector(".eco-trend-plot")).toBe(plot);
  expect(plot?.textContent).toBe("暂无数据");
});
