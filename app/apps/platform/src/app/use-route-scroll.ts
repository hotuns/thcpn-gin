import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const positions = new Map<string, number>();

export function useRouteScroll(workspaceID: string | null | undefined) {
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);
  const location = useLocation();
  const navigationType = useNavigationType();
  const previous = useRef({ workspaceID, pathname: location.pathname });
  const key = `${workspaceID ?? ""}:${location.pathname}${location.search}`;
  useLayoutEffect(() => {
    const samePage = previous.current.workspaceID === workspaceID && previous.current.pathname === location.pathname;
    previous.current = { workspaceID, pathname: location.pathname };
    let restoring = false;
    let observer: ResizeObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const stopRestore = () => { restoring = false; observer?.disconnect(); if (timer) clearTimeout(timer); };
    if (!samePage) {
      const y = navigationType === "POP" || location.state?.restoreScroll ? positions.get(key) ?? 0 : 0;
      restoring = true;
      const restore = () => {
        window.scrollTo({ top: y, behavior: "instant" });
        if (Math.abs(window.scrollY - y) < 2) stopRestore();
      };
      frame = requestAnimationFrame(restore);
      // A lazy page can temporarily be shorter than the saved scroll position.
      const main = document.getElementById("main-content");
      if (main && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => { if (restoring) restore(); });
        observer.observe(main);
      }
      timer = setTimeout(stopRestore, 1500);
    }
    const save = () => { if (!restoring) positions.set(key, window.scrollY); };
    const interrupt = () => stopRestore();
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pointerdown", interrupt, { passive: true });
    window.addEventListener("wheel", interrupt, { passive: true });
    return () => {
      stopRestore();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", save);
      window.removeEventListener("pointerdown", interrupt);
      window.removeEventListener("wheel", interrupt);
      if (positions.size > 100) positions.delete(positions.keys().next().value!);
    };
  }, [key, location.pathname, location.state, navigationType, workspaceID]);
}
