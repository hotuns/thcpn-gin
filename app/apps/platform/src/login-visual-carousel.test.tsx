// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginVisualCarousel, LOGIN_VISUAL_HOLD_MS } from "./login-visual-carousel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ControlledImage {
  static instances: ControlledImage[] = [];
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  decoding = "async";
  src = "";
  decode = vi.fn(async () => undefined);
  constructor() { ControlledImage.instances.push(this); }
  async finish() { await this.onload?.(); }
}

describe("login visual carousel", () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    ControlledImage.instances = [];
    vi.stubGlobal("Image", ControlledImage);
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); host.remove(); });

  it("never advances until the next image has loaded and decoded", async () => {
    const root = createRoot(host);
    await act(async () => root.render(<LoginVisualCarousel items={[{id:"one",url:"/one.jpg"},{id:"two",url:"/two.jpg"}]}/>));

    expect(host.querySelector("img")).toBeNull();
    await act(async () => ControlledImage.instances[0].finish());
    expect(host.querySelector("img.is-active")?.getAttribute("src")).toBe("/one.jpg");

    await act(async () => vi.advanceTimersByTimeAsync(LOGIN_VISUAL_HOLD_MS * 2));
    expect(host.querySelector("img.is-active")?.getAttribute("src")).toBe("/one.jpg");

    await act(async () => ControlledImage.instances[1].finish());
    await act(async () => vi.advanceTimersByTimeAsync(LOGIN_VISUAL_HOLD_MS - 1));
    expect(host.querySelector("img.is-active")?.getAttribute("src")).toBe("/one.jpg");
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(host.querySelector("img.is-active")?.getAttribute("src")).toBe("/two.jpg");

    await act(async () => root.unmount());
  });
});
