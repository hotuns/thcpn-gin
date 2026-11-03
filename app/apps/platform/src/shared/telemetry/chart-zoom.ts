import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type WheelEvent } from "react";

export function useChartZoom(min: number, max: number) {
  const [domain, setDomain] = useState<[number, number]>([min, max]);
  const [isDragging, setDragging] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; touch: boolean; width: number; domain: [number, number] } | null>(null);
  const moved = useRef(false);
  const valid = Number.isFinite(min) && Number.isFinite(max) && max > min;
  const canPan = valid && domain[1] - domain[0] < max - min;

  useEffect(() => {
    setDomain([min, max]);
    drag.current = null;
    setDragging(false);
  }, [min, max]);

  useEffect(() => {
    if (!element) return;
    // React delegates wheel with a passive listener, so cancellation must be native.
    const preventPageScroll = (event: globalThis.WheelEvent) => {
      if (valid && (event.ctrlKey || event.metaKey) && event.deltaY !== 0 && !drag.current) event.preventDefault();
    };
    element.addEventListener("wheel", preventPageScroll, { passive: false });
    return () => element.removeEventListener("wheel", preventPageScroll);
  }, [element, valid]);

  const scaleZoom = (factor: number, ratio = 0.5) => {
    if (!valid || drag.current) return;
    setDomain(([start, end]) => {
      const span = end - start;
      const nextSpan = Math.min(max - min, Math.max((max - min) / 1000, span * factor));
      const nextStart = Math.min(max - nextSpan, Math.max(min, start + span * ratio - nextSpan * ratio));
      return [nextStart, nextStart + nextSpan];
    });
  };
  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (!valid || drag.current || event.deltaY === 0 || (!event.ctrlKey && !event.metaKey)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    scaleZoom(event.deltaY < 0 ? 0.8 : 1.25, ratio);
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    moved.current = false;
    if (event.button !== 0 || !event.isPrimary || !canPan) return;
    const width = event.currentTarget.getBoundingClientRect().width;
    if (!width) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === "touch", width, domain };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const delta = event.clientX - current.x;
    if (!moved.current && current.touch && Math.abs(event.clientY - current.y) > Math.max(4, Math.abs(delta))) {
      endDrag(event);
      return;
    }
    if (!moved.current && Math.abs(delta) < 4) return;
    moved.current = true;
    setDragging(true);
    const span = current.domain[1] - current.domain[0];
    const start = Math.min(max - span, Math.max(min, current.domain[0] - delta / current.width * span));
    setDomain([start, start + span]);
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!moved.current) return false;
    moved.current = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  const resetZoom = () => { drag.current = null; setDragging(false); setDomain([min, max]); };
  return {
    domain, isDragging, onWheel, resetZoom, onClickCapture,
    zoomIn: () => scaleZoom(0.8), zoomOut: () => scaleZoom(1.25),
    canZoomIn: valid && domain[1] - domain[0] > (max - min) / 1000,
    canZoomOut: canPan,
    interactionProps: {
      ref: setElement,
      onWheel, onDoubleClick: resetZoom, onPointerDown, onPointerMove,
      onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onClickCapture,
      title: "按住 Ctrl 或 ⌘ 滚轮缩放，左右拖动平移，双击恢复完整范围",
      style: { cursor: isDragging ? "grabbing" : canPan ? "grab" : undefined, touchAction: "pan-y", userSelect: "none" } as CSSProperties,
    },
  };
}
