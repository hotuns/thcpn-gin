import { act, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { AnimatedNumber } from "../../apps/platform/src/features/atlas/eco-animated-number";
import { render } from "../render";
let time: number;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
beforeEach(() => {
  time = 0; sequence = 0; frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { const id = ++sequence; frames.set(id, callback); return id; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
async function frame(next: number) {
  time = next;
  const callbacks = [...frames.values()]; frames.clear();
  await act(async () => callbacks.forEach(callback => callback(next)));
}
function Controls() {
  const [value, setValue] = useState(100);
  const [enabled, setEnabled] = useState(true);
  return <><AnimatedNumber value={value} enabled={enabled} /><button onClick={() => setValue(125)}>更新</button><button onClick={() => setEnabled(false)}>暂停</button></>;
}
it("counts initial and actual updates to exact final values, then stops scheduling frames", async () => {
  const { host } = await render(<Controls />);
  const text = () => host.querySelector(".eco-number")!.textContent!;
  expect(text()).toBe("0");
  await frame(250);
  expect(Number(text())).toBeGreaterThan(0);
  expect(Number(text())).toBeLessThan(100);
  await frame(500);
  expect(text()).toBe("100");
  expect(frames.size).toBe(0);
  await act(async () => host.querySelectorAll<HTMLButtonElement>("button")[0].click());
  expect(text()).toBe("100");
  await frame(750);
  expect(Number(text())).toBeGreaterThan(100);
  expect(Number(text())).toBeLessThan(125);
  await frame(1000);
  expect(text()).toBe("125");
  expect(frames.size).toBe(0);
});
it("keeps missing and nonfinite readings unknown without count animations", async () => {
  const { host } = await render(<><AnimatedNumber value={null} enabled /><AnimatedNumber value={undefined} enabled /><AnimatedNumber value={NaN} enabled /><AnimatedNumber value={Infinity} enabled /></>);
  expect([...host.querySelectorAll(".eco-number")].map(element => element.textContent)).toEqual(["—", "—", "—", "—"]);
  expect(frames.size).toBe(0);
});
it("snaps to the real reading when paused, and never interpolates disabled or reduced motion values", async () => {
  const { host } = await render(<Controls />);
  await frame(100);
  await act(async () => host.querySelectorAll<HTMLButtonElement>("button")[1].click());
  expect(host.querySelector(".eco-number")!.textContent).toBe("100");
  expect(frames.size).toBe(0);
  const disabled = await render(<AnimatedNumber value={23.6} enabled={false} />);
  expect(disabled.host.textContent).toBe("23.6");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const reduced = await render(<AnimatedNumber value={68.2} enabled />);
  expect(reduced.host.textContent).toBe("68.2");
  expect(frames.size).toBe(0);
});
it("preserves the caller's exact final formatting", async () => {
  const { host } = await render(<AnimatedNumber value={96.9} enabled formatter={value => `${value.toFixed(1)}%`} />);
  await frame(500);
  expect(host.textContent).toBe("96.9%");
  expect(host.querySelector(".eco-number")?.getAttribute("aria-label")).toBe("96.9%");
});
