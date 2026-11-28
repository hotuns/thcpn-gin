import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import "./atlas-sliding-tabs.css";

export type SlidingTabItem<T extends string = string> = {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  dataKind?: string;
};

type Props<T extends string> = {
  items: readonly SlidingTabItem<T>[];
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  motionEnabled?: boolean;
};

/** Segmented sliding pill control aligned with transitions.dev #16 Tabs sliding. */
export function SlidingTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className = "",
  motionEnabled = true,
}: Props<T>) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const hasPainted = useRef(false);

  const syncPill = useCallback(
    (animate: boolean) => {
      const pill = pillRef.current;
      if (!pill) return;
      const activeEl = value != null ? buttonRefs.current.get(value) : undefined;
      if (!activeEl) {
        pill.style.opacity = "0";
        pill.style.width = "0px";
        return;
      }
      const shouldAnimate = animate && motionEnabled;
      if (!shouldAnimate) {
        const prev = pill.style.transition;
        pill.style.transition = "none";
        pill.style.opacity = "1";
        pill.style.transform = `translateX(${activeEl.offsetLeft}px)`;
        pill.style.width = `${activeEl.offsetWidth}px`;
        void pill.offsetWidth;
        pill.style.transition = prev;
      } else {
        pill.style.opacity = "1";
        pill.style.transform = `translateX(${activeEl.offsetLeft}px)`;
        pill.style.width = `${activeEl.offsetWidth}px`;
      }
    },
    [value, motionEnabled],
  );

  useLayoutEffect(() => {
    syncPill(hasPainted.current);
    hasPainted.current = true;
  }, [syncPill, items.length]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncPill(false));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [syncPill]);

  return (
    <div
      ref={barRef}
      className={`t-tabs obs-sliding-tabs ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
    >
      <span ref={pillRef} className="t-tabs-pill obs-sliding-pill" aria-hidden="true" />
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              if (el) buttonRefs.current.set(item.value, el);
              else buttonRefs.current.delete(item.value);
            }}
            type="button"
            className="t-tab obs-sliding-tab"
            data-kind={item.dataKind}
            aria-label={item.ariaLabel}
            aria-pressed={active}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
