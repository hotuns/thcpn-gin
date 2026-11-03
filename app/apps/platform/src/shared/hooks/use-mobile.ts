import { useSyncExternalStore } from "react";

export const mobileMediaQuery = "(max-width: 767px)";

const subscribe = (onChange: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(mobileMediaQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const getSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(mobileMediaQuery).matches;

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
