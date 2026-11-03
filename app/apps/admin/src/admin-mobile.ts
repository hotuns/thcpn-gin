import { useSyncExternalStore } from "react";

export const adminMobileQuery = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(adminMobileQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Keep JS interactions aligned with the admin stylesheet's phone breakpoint. */
export function useAdminMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(adminMobileQuery).matches, () => false);
}
