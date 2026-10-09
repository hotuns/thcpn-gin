import { useEffect, useState } from "react";

export function useSceneReveal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // A deferred state change lets the CSS panel transition start from its
    // resting state. Reduced-motion users get an immediate, stationary reveal.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setOpen(true);
      return;
    }
    const timer = window.setTimeout(() => setOpen(true), 40);
    return () => window.clearTimeout(timer);
  }, []);
  return open;
}
