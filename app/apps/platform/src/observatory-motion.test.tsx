// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObservatoryAutoScroll, ObservatoryMotionToggle, useObservatoryMotion } from "./observatory-motion";

vi.mock("@thcpn/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, clock = 0, next = 0;
let callbacks: Map<number, FrameRequestCallback>;
let reduced = false;
let preference: (() => void) | undefined;
const removePreference = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clock = 0; next = 0; reduced = false; preference = undefined; callbacks = new Map();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => { preference = fn; }, removeEventListener: removePreference }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); removePreference.mockClear(); });
async function step(time: number) { clock = time; const pending = [...callbacks.values()]; callbacks.clear(); await act(async () => pending.forEach(callback => callback(time))); }
async function mount(paused = false) {
  await act(async () => root.render(<ObservatoryAutoScroll label="Devices" paused={paused}><button>Device one</button><button>Device two</button></ObservatoryAutoScroll>));
  const list = host.firstElementChild as HTMLDivElement;
  Object.defineProperties(list, { scrollHeight: { value: 500, configurable: true }, clientHeight: { value: 100 } });
  return list;
}
describe("observatory motion", () => {
  it("pauses on pointer hover and while the document is hidden", async () => {
    const list = await mount();
    await step(2600); await step(2680);
    const before = list.scrollTop;
    await act(async () => list.dispatchEvent(new Event("pointerover", { bubbles: true })));
    await step(4000); expect(list.scrollTop).toBe(before);
    await act(async () => list.dispatchEvent(new Event("pointerout", { bubbles: true })));
    await step(7000); expect(list.scrollTop).toBeGreaterThan(before);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const hidden = list.scrollTop; await step(8000); expect(list.scrollTop).toBe(hidden);
  });
  it("scrolls only overflowing content, pauses for focus/wheel, reverses at the edge and cleans up", async () => {
    const list = await mount();
    expect(callbacks.size).toBe(1);
    expect(document.hidden).toBe(false);
    await step(2600); await step(2680); expect(list.scrollTop).toBeGreaterThan(0);
    const previous = list.scrollTop;
    await act(async () => list.querySelector("button")!.focus());
    await step(2760); expect(list.scrollTop).toBe(previous);
    await act(async () => list.querySelector("button")!.blur());
    await step(5400); await step(5480); expect(list.scrollTop).toBeGreaterThan(previous);
    list.scrollTop = 399;
    await step(5560); expect(list.scrollTop).toBe(400);
    await step(8200); await step(8280); expect(list.scrollTop).toBeLessThan(400);
    await act(async () => list.dispatchEvent(new Event("wheel", { bubbles: true })));
    const manual = list.scrollTop; await step(9000); expect(list.scrollTop).toBe(manual);
    expect(host.querySelectorAll("button")).toHaveLength(2); // No duplicate interactive rows.
    await act(async () => root.render(null)); expect(callbacks.size).toBe(0);
  });
  it("does not scroll short lists or start a loop when paused/reduced", async () => {
    const list = await mount(); Object.defineProperty(list, "scrollHeight", { value: 90 });
    await step(2600); await step(2680); expect(list.scrollTop).toBe(0);
    await act(async () => root.render(<ObservatoryAutoScroll label="Devices" paused>Short list</ObservatoryAutoScroll>));
    expect(callbacks.size).toBe(0);
    reduced = true;
    await act(async () => root.render(<ObservatoryAutoScroll label="Devices">Short list</ObservatoryAutoScroll>));
    expect(callbacks.size).toBe(0);
  });
  it("allows manual pause and respects live reduced-motion preference changes", async () => {
    function Fixture() { const motion = useObservatoryMotion(); return <div data-enabled={motion.enabled}><ObservatoryMotionToggle motion={motion}/></div>; }
    await act(async () => root.render(<Fixture/>));
    expect(host.firstElementChild?.getAttribute("data-enabled")).toBe("true");
    await act(async () => host.querySelector("button")!.click());
    expect(host.firstElementChild?.getAttribute("data-enabled")).toBe("false");
    expect(host.querySelector("button")!.getAttribute("aria-label")).toBe("atlas.motionPlay");
    await act(async () => host.querySelector("button")!.click());
    reduced = true; await act(async () => preference?.());
    expect(host.firstElementChild?.getAttribute("data-enabled")).toBe("false");
    expect(host.querySelector("button")!.disabled).toBe(true);
    await act(async () => root.render(null)); expect(removePreference).toHaveBeenCalled();
  });
});
