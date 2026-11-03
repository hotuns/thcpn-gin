import { useEffect, useMemo, useRef, useState } from "react";

export const LOGIN_VISUAL_HOLD_MS = 5_000;

type LoginVisual = { id: string; url: string };

const followingIndex = (count: number, current: number, failed: Set<number>) => {
  for (let offset = 1; offset <= count; offset += 1) {
    const candidate = (current + offset) % count;
    if (!failed.has(candidate)) return candidate;
  }
  return null;
};

export function LoginVisualCarousel({ items }: { items: LoginVisual[] }) {
  const identity = items.map((item) => `${item.id}:${item.url}`).join("|");
  const previousIdentity = useRef(identity);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedIndices, setLoadedIndices] = useState<Set<number>>(() => new Set());
  const [failedIndices, setFailedIndices] = useState<Set<number>>(() => new Set());
  const nextIndex = useMemo(
    () => followingIndex(items.length, activeIndex, failedIndices),
    [activeIndex, failedIndices, items.length],
  );

  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    setActiveIndex(0);
    setLoadedIndices(new Set());
    setFailedIndices(new Set());
  }, [identity]);

  useEffect(() => {
    if (!items.length) return;
    const targetIndex = loadedIndices.has(activeIndex) ? nextIndex : activeIndex;
    if (targetIndex === null || loadedIndices.has(targetIndex) || failedIndices.has(targetIndex)) return;

    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try { await image.decode?.(); } catch { /* A loaded image can still be safely displayed. */ }
      if (cancelled) return;
      setLoadedIndices((current) => new Set(current).add(targetIndex));
    };
    image.onerror = () => {
      if (cancelled) return;
      setFailedIndices((current) => new Set(current).add(targetIndex));
      if (targetIndex === activeIndex) {
        const fallback = followingIndex(items.length, activeIndex, new Set(failedIndices).add(targetIndex));
        if (fallback !== null) setActiveIndex(fallback);
      }
    };
    image.src = items[targetIndex].url;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, [activeIndex, failedIndices, items, loadedIndices, nextIndex]);

  useEffect(() => {
    if (items.length < 2 || nextIndex === null || !loadedIndices.has(activeIndex) || !loadedIndices.has(nextIndex)) return;
    const timer = window.setTimeout(() => setActiveIndex(nextIndex), LOGIN_VISUAL_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, items.length, loadedIndices, nextIndex]);

  if (!items.length || !loadedIndices.has(activeIndex)) return null;
  return <div className="auth-visual-carousel" aria-hidden="true">
    {items.map((item, index) => loadedIndices.has(index) ? <img key={item.id} src={item.url} alt="" decoding="async" fetchPriority={index === activeIndex ? "high" : "low"} className={index === activeIndex ? "is-active" : ""}/> : null)}
  </div>;
}
