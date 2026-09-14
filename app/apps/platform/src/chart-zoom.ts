import { useEffect, useState, type WheelEvent } from "react";

export function useChartZoom(min: number, max: number) {
  const [domain, setDomain] = useState<[number, number]>([min, max]);

  useEffect(() => setDomain([min, max]), [min, max]);

  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (!(max > min)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const [start, end] = domain;
    const span = end - start;
    const nextSpan = Math.min(max - min, Math.max((max - min) / 1000, span * (event.deltaY < 0 ? 0.8 : 1.25)));
    let nextStart = start + span * ratio - nextSpan * ratio;
    nextStart = Math.min(max - nextSpan, Math.max(min, nextStart));
    setDomain([nextStart, nextStart + nextSpan]);
  };

  return {
    domain,
    onWheel,
    resetZoom: () => setDomain([min, max]),
  };
}
