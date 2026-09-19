// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useChartZoom } from "./chart-zoom";

it("zooms without scrolling the page, pans within bounds and suppresses drag clicks", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let zoom!: ReturnType<typeof useChartZoom>;
  function Chart() { zoom = useChartZoom(0, 100); return <div {...zoom.interactionProps}/>; }
  try {
    await act(async () => root.render(<Chart/>));
    const element = container.firstElementChild as HTMLElement;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({left:0,width:100} as DOMRect);
    const wheel = new WheelEvent("wheel", {bubbles:true,cancelable:true,deltaY:-1,clientX:50});
    await act(async () => { element.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(true);
    expect(zoom.domain).toEqual([10,90]);
    const target = {getBoundingClientRect:()=>({width:100}),setPointerCapture:vi.fn(),hasPointerCapture:()=>true,releasePointerCapture:vi.fn()};
    await act(async () => zoom.interactionProps.onPointerDown({button:0,isPrimary:true,pointerId:1,clientX:50,currentTarget:target} as unknown as Parameters<typeof zoom.interactionProps.onPointerDown>[0]));
    await act(async () => zoom.interactionProps.onPointerMove({pointerId:1,clientX:60} as Parameters<typeof zoom.interactionProps.onPointerMove>[0]));
    expect(zoom.domain).toEqual([2,82]);
    expect(zoom.isDragging).toBe(true);
    await act(async () => zoom.interactionProps.onPointerMove({pointerId:1,clientX:500} as Parameters<typeof zoom.interactionProps.onPointerMove>[0]));
    expect(zoom.domain).toEqual([0,80]);
    await act(async () => zoom.interactionProps.onPointerUp({pointerId:1,currentTarget:target} as unknown as Parameters<typeof zoom.interactionProps.onPointerUp>[0]));
    expect(zoom.isDragging).toBe(false);
    const click = {preventDefault:vi.fn(),stopPropagation:vi.fn()};
    expect(zoom.onClickCapture(click as unknown as Parameters<typeof zoom.onClickCapture>[0])).toBe(true);
    expect(click.preventDefault).toHaveBeenCalled();
    await act(async () => zoom.resetZoom());
    expect(zoom.domain).toEqual([0,100]);
    await act(async () => root.unmount());
    const detachedWheel = new WheelEvent("wheel", {cancelable:true});
    element.dispatchEvent(detachedWheel);
    expect(detachedWheel.defaultPrevented).toBe(false);
  } finally { container.remove(); vi.restoreAllMocks(); }
});
