import { useEffect, useRef, useState } from "react";
import { numberLabel } from "./atlas-model";
import "./eco-animated-number.css";

export type AnimatedNumberProps = {
  value: number | null | undefined;
  enabled?: boolean;
  formatter?: (value: number) => string;
  decimals?: number;
  className?: string;
};

const COUNT_DURATION = 500;
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Runs only when a real reading changes; unknown values never become zero. */
export function AnimatedNumber({ value, enabled = false, formatter, decimals, className = "" }: AnimatedNumberProps) {
  const target = typeof value === "number" && Number.isFinite(value) ? value : null;
  const reduced = useReducedMotion();
  const active = enabled && !reduced;
  const [displayed, setDisplayed] = useState<number | null>(() => active && target !== null ? 0 : target);
  const current = useRef(displayed);
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!active || target === null) {
      current.current = target;
      setDisplayed(target);
      return;
    }
    const from = current.current ?? 0;
    if (from === target) return;
    const duration = Number.parseFloat(host.current ? getComputedStyle(host.current).getPropertyValue("--digit-dur") : "") || COUNT_DURATION;
    const start = performance.now();
    let frame: number;
    const tick = (time: number) => {
      const progress = Math.max(0, Math.min(1, (time - start) / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = progress === 1 ? target : from + (target - from) * eased;
      current.current = next;
      setDisplayed(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);
  const precision = decimals ?? (target !== null && Number.isInteger(target) ? 0 : Math.min(3, String(target).split(".")[1]?.length ?? 3));
  const format = formatter ?? ((number: number) => numberLabel(Number(number.toFixed(precision))));
  const finalText = target === null ? "—" : format(target);
  const numeric = active ? displayed : target;
  const text = target === null ? "—" : format(numeric ?? target);
  return <span ref={host} className={`eco-number ${className}`} role="group" aria-label={finalText} data-animating={active && target !== null}>
    <span key={target ?? "unknown"} className={`eco-number-digits t-digit-group${active && target !== null ? " is-animating" : ""}`} aria-hidden="true">{[...text].map((digit, index, digits) => <span className="eco-number-digit t-digit" key={index} data-stagger={index === digits.length - 1 ? 2 : index === digits.length - 2 ? 1 : undefined}>{digit}</span>)}</span>
  </span>;
}
