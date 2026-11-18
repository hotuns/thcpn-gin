import { useEffect, useRef } from "react";
import { parsePath, useBlocker, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useLocale } from "@thcpn/i18n";
import { useWorkspace } from "@thcpn/workspace";
import { useIsMobile } from "../shared/hooks/use-mobile";
import { findPlatformRoute } from "./platform-routes";

type NavigationSource = { navigationSource: { to: string; workspaceId: string | null; restoreByUrl?: boolean } };
export type PlatformOutletContext = {
  openGuide: () => void;
  exitEditorForWorkspace: { current: (() => boolean) | null };
};
export const restoreScroll = { restoreScroll: true };

export function useNavigationSource(): NavigationSource {
  const location = useLocation();
  const { currentId } = useWorkspace();
  return { navigationSource: { to: `${location.pathname}${location.search}${location.hash}`, workspaceId: currentId } };
}

function useNavigationOrigin() {
  const location = useLocation();
  const { currentId } = useWorkspace();
  const source = (location.state as Partial<NavigationSource> | null)?.navigationSource;
  if (!source || source.workspaceId !== currentId || typeof source.to !== "string" || !source.to.startsWith("/")) return;
  const path = parsePath(source.to);
  if (path.pathname === location.pathname || !findPlatformRoute(path.pathname ?? "")) return;
  return { ...source, pathname: path.pathname, search: path.search };
}

export function usePlatformReturn() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const origin = useNavigationOrigin();
  const route = findPlatformRoute(pathname);
  let target = route?.parent ?? (mobile ? route?.mobileParent : undefined);
  if (origin && (route?.key === "notifications" || (target && origin.pathname === parsePath(target).pathname))) target = origin.to;

  const key = target ? findPlatformRoute(parsePath(target).pathname ?? "")?.key : undefined;
  const back = () => {
    if (!target) return;
    if (origin?.to === target && !origin.restoreByUrl) void navigate(-1);
    else void navigate(target, { replace: true, state: restoreScroll });
  };

  return { target, key, back };
}

export function useEditorNavigation(dirty: boolean, busy = false) {
  const { t } = useLocale();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const context = useOutletContext<PlatformOutletContext | null>();
  const origin = useNavigationOrigin();
  const route = findPlatformRoute(pathname);
  const parent = route?.parent;
  const exitEditorForWorkspace = context?.exitEditorForWorkspace;
  const completing = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !completing.current && (dirty || busy) && (
      currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
    ),
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (!busy && window.confirm(t("platform:navigation.leaveEditor"))) blocker.proceed();
    else blocker.reset();
  }, [blocker, busy, t]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  useEffect(() => {
    if (!exitEditorForWorkspace || !parent) return;
    exitEditorForWorkspace.current = () => {
      if (busy || (dirty && !window.confirm(t("platform:navigation.leaveEditor")))) return false;
      completing.current = true;
      const list = findPlatformRoute(parent)?.parent ?? parent;
      void navigate(list, { replace: true });
      return true;
    };
    return () => { exitEditorForWorkspace.current = null; };
  }, [busy, dirty, exitEditorForWorkspace, navigate, parent, t]);

  const fromData = origin?.pathname === "/data-compare"
    || (findPlatformRoute(origin?.pathname ?? "")?.key === "deviceDetails" && new URLSearchParams(origin?.search).get("tab") === "data");
  const cancel = () => {
    if (!parent || busy) return;
    if (origin && (origin.pathname === parent || (route?.editor === "create" && fromData))) {
      if (origin.restoreByUrl) void navigate(origin.to, { replace: true, state: restoreScroll });
      else void navigate(-1);
    } else void navigate(parent, { replace: true, state: restoreScroll });
  };

  const complete = (to: string, state?: Record<string, unknown>) => {
    completing.current = true;
    if (!state && route?.editor === "edit" && origin?.pathname === to && !origin.restoreByUrl) {
      void navigate(-1);
      return;
    }
    const resultParent = findPlatformRoute(parsePath(to).pathname ?? "")?.parent;
    const returnedFromParent = origin && !origin.restoreByUrl && resultParent === origin.pathname;
    void navigate(to, {
      replace: true,
      state: returnedFromParent ? { ...state, navigationSource: { to: origin.to, workspaceId: origin.workspaceId } } : state,
    });
  };

  return { cancel, complete };
}
