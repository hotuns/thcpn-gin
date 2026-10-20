import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ForwardedRef, type ReactNode } from "react";

export type DataVProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  color?: readonly [string, string];
  backgroundColor?: string;
  reverse?: boolean;
};

// DataV's old MutationObserver hook missed flex/grid size changes. Observe the
// component itself, including fullscreen and sidebar changes; clean up in StrictMode.
export function useAutoResize(forwardedRef: ForwardedRef<HTMLDivElement>) {
  const element = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const domRef = useCallback((node: HTMLDivElement | null) => {
    element.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return { ...size, domRef };
}

// Only fixed six-digit palette tokens are passed by our presentation layer.
export function fade(hex: string, opacity: number) {
  const value = parseInt(hex.replace("#", ""), 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${opacity / 100})`;
}
