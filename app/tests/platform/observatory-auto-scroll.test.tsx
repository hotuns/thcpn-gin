import { act, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ObservatoryAutoScroll } from "../../apps/platform/src/shared/observatory/observatory-motion";
import { render } from "../render";

let now: number;
let frameId: number;
let reduced: boolean;
let callbacks: Map<number, FrameRequestCallback>;

beforeEach(() => {
  now = 0;
  frameId = 0;
  reduced = false;
  callbacks = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callbacks.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));
});

// Advance the browser frame clock without real timers or wall-clock sleeps.
async function frame(time: number) {
  now = time;
  const pending = [...callbacks.values()];
  callbacks.clear();
  await act(async () => pending.forEach(callback => callback(time)));
}

async function mount({ paused = false, overflow = 100 } = {}) {
  function Harness() {
    const [stopped, setStopped] = useState(paused);
    const [reset, setReset] = useState(0);
    return <>
      <button data-control="pause" onClick={() => setStopped(value => !value)}>Toggle pause</button>
      <button data-control="reset" onClick={() => setReset(value => value + 1)}>Change list</button>
      <ObservatoryAutoScroll label="组网节点" paused={stopped} resetKey={String(reset)}>
        <button>节点 01</button><button>节点 02</button>
      </ObservatoryAutoScroll>
    </>;
  }
  const { host } = await render(<Harness />);
  const region = host.querySelector<HTMLDivElement>('[role="region"]')!;
  Object.defineProperties(region, {
    scrollHeight: { configurable: true, value: 100 + overflow },
    clientHeight: { configurable: true, value: 100 },
  });
  return { host, region };
}

async function startScrolling() {
  await frame(100);
  await frame(2499);
  await frame(2580);
}

async function pointer(region: HTMLElement, type: "pointerover" | "pointerout", pointerType = "mouse") {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget: null });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  await act(async () => region.dispatchEvent(event));
}

it("waits for the initial reading delay, then advances an overflowing list without changing focus", async () => {
  const { region } = await mount();
  const active = document.activeElement;
  await frame(100);
  await frame(2499);
  expect(region.scrollTop).toBe(0);
  await frame(2580);
  expect(region.scrollTop).toBeGreaterThan(0);
  expect(document.activeElement).toBe(active);
  expect(region.querySelectorAll("button")).toHaveLength(2);
});

it("pauses at the bottom before reversing, without scrolling outside the list", async () => {
  const { region } = await mount({ overflow: 10 });
  await startScrolling();
  while (region.scrollTop < 10 && now < 5000) await frame(now + 80);
  expect(region.scrollTop).toBe(10);
  const reachedBottom = now;
  await frame(reachedBottom + 2499);
  expect(region.scrollTop).toBe(10);
  await frame(reachedBottom + 2580);
  expect(region.scrollTop).toBeLessThan(10);
  expect(region.scrollTop).toBeGreaterThanOrEqual(0);
});

it("pauses while the mouse hovers and allows reading time after the mouse leaves", async () => {
  const { region } = await mount();
  await startScrolling();
  const position = region.scrollTop;
  await pointer(region, "pointerover");
  await frame(now + 10000);
  expect(region.scrollTop).toBe(position);
  await pointer(region, "pointerout");
  const leftAt = now;
  await frame(leftAt + 2499);
  expect(region.scrollTop).toBe(position);
  await frame(leftAt + 2580);
  expect(region.scrollTop).toBeGreaterThan(position);
});

it("keeps scrolling for touch hover events", async () => {
  const { region } = await mount();
  await startScrolling();
  const position = region.scrollTop;
  await pointer(region, "pointerover", "touch");
  await frame(now + 80);
  expect(region.scrollTop).toBeGreaterThan(position);
});

it("pauses while keyboard focus stays inside the list, including when moving between rows", async () => {
  const { host, region } = await mount();
  await startScrolling();
  const position = region.scrollTop;
  const rows = region.querySelectorAll<HTMLButtonElement>("button");
  await act(async () => rows[0].focus());
  await frame(now + 10000);
  expect(region.scrollTop).toBe(position);
  await act(async () => rows[1].focus());
  await frame(now + 10000);
  expect(region.scrollTop).toBe(position);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-control="reset"]')!.focus());
  const leftAt = now;
  await frame(leftAt + 2499);
  expect(region.scrollTop).toBe(position);
  await frame(leftAt + 2580);
  expect(region.scrollTop).toBeGreaterThan(position);
});

it("yields to wheel scrolling and resumes from the user's position after eight seconds", async () => {
  const { region } = await mount();
  await startScrolling();
  await act(async () => {
    region.scrollTop = 40;
    region.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 40 }));
  });
  const interactedAt = now;
  await frame(interactedAt + 7999);
  expect(region.scrollTop).toBe(40);
  await frame(interactedAt + 8080);
  expect(region.scrollTop).toBeGreaterThan(40);
});

it.each(["paused", "reduced motion"])("does not schedule animation when %s is enabled", async mode => {
  reduced = mode === "reduced motion";
  const { region } = await mount({ paused: mode === "paused" });
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  await frame(10000);
  expect(region.scrollTop).toBe(0);
});

it("cancels the pending frame when paused and waits again before resuming", async () => {
  const { host, region } = await mount();
  await startScrolling();
  const position = region.scrollTop;
  const toggle = host.querySelector<HTMLButtonElement>('[data-control="pause"]')!;
  await act(async () => toggle.click());
  expect(cancelAnimationFrame).toHaveBeenCalled();
  expect(callbacks.size).toBe(0);
  await frame(now + 10000);
  expect(region.scrollTop).toBe(position);
  await act(async () => toggle.click());
  const resumedAt = now;
  await frame(resumedAt + 2499);
  expect(region.scrollTop).toBe(position);
  await frame(resumedAt + 2580);
  expect(region.scrollTop).toBeGreaterThan(position);
});

it("resets to the top and restarts the reading delay when the list changes", async () => {
  const { host, region } = await mount();
  await startScrolling();
  expect(region.scrollTop).toBeGreaterThan(0);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-control="reset"]')!.click());
  expect(region.scrollTop).toBe(0);
  expect(cancelAnimationFrame).toHaveBeenCalled();
  const resetAt = now;
  await frame(resetAt + 2499);
  expect(region.scrollTop).toBe(0);
  await frame(resetAt + 2580);
  expect(region.scrollTop).toBeGreaterThan(0);
});

it("leaves a list that fits within its viewport stationary", async () => {
  const { region } = await mount({ overflow: 0 });
  await startScrolling();
  await frame(now + 10000);
  expect(region.scrollTop).toBe(0);
});
