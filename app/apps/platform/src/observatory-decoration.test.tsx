// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ObservatoryMasthead, ObservatoryPanelFrame, ObservatoryTitle } from "./observatory-decoration";

describe("observatory decorations", () => {
  it("keeps the heading semantic and escapes user-supplied board names", () => {
    const html = renderToStaticMarkup(<ObservatoryTitle title={'样地 <script>'} description="观测说明" className="atlas-title" />);
    expect(html).toContain('aria-label="样地 &lt;script&gt;"');
    expect(html).toContain('aria-hidden="true">样地 &lt;script&gt;</span>');
    expect(html).toContain('obs-title atlas-title');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('观测说明');
    expect(html.indexOf('观测说明')).toBeLessThan(html.indexOf('<h1'));
    expect(html).not.toMatch(/<p[\s>]/);
    expect(html).not.toContain('IN-SITU');
  });
  it("does not add interactive elements or empty descriptions", () => {
    const html = renderToStaticMarkup(<><ObservatoryMasthead /><ObservatoryPanelFrame /><ObservatoryTitle title="数字样地" description="  " /></>);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
    expect(html).not.toMatch(/<p[\s>]/);
    expect(html).not.toContain('obs-title-eyebrow');
    expect(html).toContain('dv-decoration-8');
    expect(html).toContain('dv-decoration-5');
    expect(html).toContain('dv-decoration-11');
    expect(html).not.toContain('dv-border-box-12');
    expect(html).not.toContain('obs-screen-frame');
    expect(html).toContain('dv-border-box-13');
    expect(html).not.toContain('<animate');
  });
  it("resizes panel geometry and disconnects observers without an outer frame", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const callbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe() {}
      disconnect = disconnect;
    });
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(160);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<><ObservatoryPanelFrame /><ObservatoryPanelFrame /><ObservatoryPanelFrame /></>));
      expect(container.querySelector("svg")?.getAttribute("width")).toBe("640");
      expect(container.querySelector('.dv-border-box-12')).toBeNull();
      expect(container.querySelector('.dv-border-box-13')).not.toBeNull();
      width.mockReturnValue(900);
      await act(async () => callbacks.forEach(callback => callback([], {} as ResizeObserver)));
      expect(container.querySelector("svg")?.getAttribute("width")).toBe("900");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      width.mockRestore();
      height.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(disconnect).toHaveBeenCalledTimes(3);
  });
});
