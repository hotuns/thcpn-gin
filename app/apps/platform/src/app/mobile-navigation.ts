export type MobileSection = "overview" | "devices" | "alerts" | "data" | "more";

export function mobileSection(path: string): MobileSection {
  if (/^\/(devices|device-map|claim)(\/|$)/.test(path)) return "devices";
  if (/^\/(alerts|notifications)(\/|$)/.test(path)) return "alerts";
  if (/^\/(data|data-compare|datasets|processing|exports)(\/|$)/.test(path)) return "data";
  return path === "/dashboard" ? "overview" : "more";
}

export function mobileParent(path: string): string | undefined {
  if (/^\/devices\//.test(path) || /^\/claim(\/|$)/.test(path) || path === "/device-map") return "/devices";
  if (/^\/datasets\//.test(path)) return "/datasets";
  if (/^\/processing\//.test(path)) return "/processing";
  if (/^\/exports\//.test(path)) return "/exports";
  if (["/datasets", "/processing", "/exports", "/data-compare"].includes(path)) return "/data";
  if (path === "/notifications") return "/alerts";
  if (/^\/atlas\//.test(path)) return "/atlas";
  if (["/account", "/settings", "/workspaces", "/subscription", "/atlas"].includes(path)) return "/more";
}

export function mobileWorkbench(path: string): boolean {
  return path === "/device-map" || path.startsWith("/atlas/");
}

export function mobileEditor(path: string): boolean {
  return path === "/exports/new" || path === "/datasets/new" || /^\/datasets\/[^/]+\/edit$/.test(path);
}
