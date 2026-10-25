import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { useLocale } from "@thcpn/i18n";
import { Button } from "./platform-ui";

export function useObservatoryMotion() {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const preference = () => setReduced(query?.matches ?? false);
    const visibility = () => setHidden(document.hidden);
    query?.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    return () => { query?.removeEventListener("change", preference); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return { paused, reduced, enabled: !paused && !reduced && !hidden, toggle: () => setPaused(value => !value) };
}

export function ObservatoryMotionToggle({ motion }: { motion: ReturnType<typeof useObservatoryMotion> }) {
  const { t } = useLocale();
  const label = t(`atlas.${motion.reduced ? "motionReduced" : motion.paused ? "motionPlay" : "motionPause"}`);
  return <Button variant="ghost" className="obs-motion-toggle" disabled={motion.reduced} onClick={motion.toggle} aria-label={label} title={label} aria-pressed={motion.paused}>
    {motion.paused ? <Play size={16} /> : <Pause size={16} />}
  </Button>;
}

/** Scroll the real list, not duplicated rows. Never changes selection or focus. */
export function ObservatoryAutoScroll({ children, className = "", label, paused = false, resetKey = "" }: {
  children: ReactNode; className?: string; label: string; paused?: boolean; resetKey?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const interaction = useRef({ hover: false, focus: false, resumeAt: 0 });
  const delay = (duration = 2500) => { interaction.current.resumeAt = performance.now() + duration; };
  useEffect(() => { if (host.current) host.current.scrollTop = 0; }, [resetKey]);
  useEffect(() => {
    const element = host.current;
    if (!element || paused || typeof requestAnimationFrame !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0, last = 0, direction = 1, position = element.scrollTop;
    delay();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const elapsed = last ? Math.min(now - last, 80) : 0;
      last = now;
      if (document.hidden || interaction.current.hover || interaction.current.focus || now < interaction.current.resumeAt) return;
      const end = element.scrollHeight - element.clientHeight;
      if (end <= 1) return;
      if (Math.abs(element.scrollTop - position) > 2) position = element.scrollTop;
      position = Math.max(0, Math.min(end, position + direction * elapsed * .016));
      element.scrollTop = position;
      if (elapsed > 0 && (position >= end || position <= 0)) { direction = position >= end ? -1 : 1; delay(); }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, resetKey]);
  return <div ref={host} className={`obs-auto-scroll ${className}`} role="region" aria-label={label} tabIndex={0}
    onPointerEnter={event => { if (event.pointerType !== "touch") interaction.current.hover = true; }}
    onPointerLeave={() => { interaction.current.hover = false; delay(); }}
    onPointerDown={() => delay(8000)} onWheel={() => delay(8000)} onKeyDown={() => delay(8000)}
    onFocusCapture={() => { interaction.current.focus = true; }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { interaction.current.focus = false; delay(); } }}>
    {children}
  </div>;
}
