// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceFrame,
  dateFrame,
  flightAt,
  flights,
  inputDate,
  lastFrame,
  metricSpecs,
  metrics,
  plotFeatures,
  plots,
  reading,
} from "./digital-plot-model";
import { DigitalPlotPage } from "./digital-plot-page";

vi.mock("./digital-plot-map", () => ({
  DigitalPlotMap: ({
    frame,
    selected,
    metric,
  }: {
    frame: number;
    selected: string;
    metric: string;
  }) => (
    <div
      data-testid="map"
      data-frame={frame}
      data-selected={selected}
      data-metric={metric}
    />
  ),
}));
vi.mock("@thcpn/i18n", () => ({
  useLocale: () => ({ locale: "zh-CN", t: (s: string) => s }),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AreaChart: () => <div>Chart</div>,
  Area: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <DigitalPlotPage />
      </MemoryRouter>,
    );
  });
}
async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="digitalPlot.${label}"]`,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
describe("digital plot deterministic demo", () => {
  it("defines eight closed parcels and six stations", () => {
    expect(plots).toHaveLength(8);
    expect(plots.filter((p) => p.station)).toHaveLength(6);
    expect(plots.reduce((sum, p) => sum + p.area, 0)).toBeCloseTo(128.6);
    for (const p of plots)
      expect(p.coordinates[0]).toEqual(p.coordinates.at(-1));
    expect(plotFeatures(20, "moisture").features).toHaveLength(8);
  });
  it("keeps hourly measurements reproducible, finite and inside the legend", () => {
    for (const metric of metrics)
      for (const p of plots)
        for (let f = 0; f <= lastFrame; f++) {
          const value = reading(p.index, f, metric);
          expect(value).toBe(reading(p.index, f, metric));
          expect(value).toBeGreaterThanOrEqual(metricSpecs[metric].min);
          expect(value).toBeLessThanOrEqual(metricSpecs[metric].max);
        }
  });
  it("does not reveal future flights and caps playback", () => {
    expect(flightAt(0)).toBeUndefined();
    expect(flightAt(33)).toBe(flights[0]);
    expect(flightAt(34)).toBe(flights[1]);
    expect(flightAt(lastFrame)).toBe(flights[2]);
    expect(advanceFrame(lastFrame)).toBe(lastFrame);
  });
  it("parses date inputs in fixed UTC+8 and handles invalid/out-of-range values", () => {
    expect(dateFrame(inputDate(59))).toBe(59);
    expect(dateFrame("")).toBeUndefined();
    expect(dateFrame("2025-01-01T00:00")).toBe(0);
    expect(dateFrame("2027-01-01T00:00")).toBe(lastFrame);
  });
  it("links parcel selection and metric selection to the map", async () => {
    await mount();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".dp-plot-row")!.click(),
    );
    expect(
      container
        .querySelector('[data-testid="map"]')
        ?.getAttribute("data-selected"),
    ).toBe("P01");
    await act(async () =>
      container
        .querySelectorAll<HTMLButtonElement>(".dp-metrics button")[1]
        .click(),
    );
    expect(
      container
        .querySelector('[data-testid="map"]')
        ?.getAttribute("data-metric"),
    ).toBe("temperature");
  });
  it("starts at the end, restarts, plays, pauses and cleans up", async () => {
    await mount();
    vi.useFakeTimers();
    await click("play");
    expect(
      container
        .querySelector('[data-testid="map"]')
        ?.getAttribute("data-frame"),
    ).toBe("0");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(
      container
        .querySelector('[data-testid="map"]')
        ?.getAttribute("data-frame"),
    ).toBe("2");
    await click("pause");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(
      container
        .querySelector('[data-testid="map"]')
        ?.getAttribute("data-frame"),
    ).toBe("2");
    await click("previous");
    expect(
      container
        .querySelector('[data-testid="map"]')
        ?.getAttribute("data-frame"),
    ).toBe("1");
    act(() => root?.unmount());
    root = undefined;
    expect(document.body.classList.contains("digital-plot-route")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
