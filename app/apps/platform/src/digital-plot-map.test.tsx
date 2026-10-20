// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DigitalPlotMap } from "./digital-plot-map";
import type { DigitalPlotMapProps } from "./digital-plot-scene";

const mock = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), dispose: vi.fn(), fail: false }));
vi.mock("./digital-plot-scene", () => ({ DigitalPlotScene: class {
  constructor(host: HTMLElement, state: unknown, callbacks: { ready: () => void }) {
    mock.create(host, state);
    if (mock.fail) throw new Error("WebGL test unavailable");
    callbacks.ready();
  }
  update = mock.update;
  dispose = mock.dispose;
} }));
vi.mock("@thcpn/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const props: DigitalPlotMapProps = { selected: "P03", frame: 158, metric: "moisture", heatmap: true, boundaries: true, stations: true, heat: true, aerial: false, opacity: 52, reset: 0, onSelect: vi.fn() };
async function mount() {
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<DigitalPlotMap {...props} />));
}
afterEach(() => {
  act(() => root?.unmount()); root = undefined; container?.remove();
  vi.clearAllMocks(); mock.fail = false;
});
describe("Three.js map integration lifecycle", () => {
  it("updates history and view in-place, disposing exactly once on exit", async () => {
    await mount();
    expect(mock.create).toHaveBeenCalledTimes(1);
    await act(async () => root!.render(<DigitalPlotMap {...props} frame={24} metric="temperature" />));
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenLastCalledWith(expect.objectContaining({ frame: 24, metric: "temperature" }));
    const toggle = container.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(mock.update).toHaveBeenLastCalledWith(expect.objectContaining({ tilted: false }));
    act(() => root!.unmount()); root = undefined;
    expect(mock.dispose).toHaveBeenCalledTimes(1);
  });
  it("reports a concrete renderer error and supports a fresh retry", async () => {
    mock.fail = true; await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("WebGL test unavailable");
    mock.fail = false;
    await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    expect(mock.create).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
