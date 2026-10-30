// Build-time presentation switch; backend authorization remains unchanged.
export const simplifiedEnabled = import.meta.env.VITE_SIMPLIFIED_ENABLED === "true";
export const billingEnabled = !simplifiedEnabled && import.meta.env.VITE_BILLING_ENABLED === "true";
export const platformHomePath = simplifiedEnabled ? "/atlas" : "/dashboard";

export function platformPathAvailable(path: string, simplified = simplifiedEnabled): boolean {
  if (!simplified) return true;
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return ["/login", "/devices", "/exports", "/exports/new", "/atlas", "/settings", "/account"].includes(pathname)
    || /^\/devices\/[^/]+$/.test(pathname)
    || /^\/atlas\/(?!topics(?:\/|$))[^/]+$/.test(pathname);
}
