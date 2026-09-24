export type PlatformBreadcrumb = { key: string; to?: string };

const root: PlatformBreadcrumb = { key: "overview", to: "/dashboard" };

export function platformBreadcrumbs(pathname: string): PlatformBreadcrumb[] {
  if (pathname === "/dashboard") return [{ key: "overview" }];
  if (pathname === "/devices") return [root, { key: "devices" }];
  if (pathname.startsWith("/devices/")) return [root, { key: "devices", to: "/devices" }, { key: "deviceDetails" }];
  if (pathname === "/device-map") return [root, { key: "deviceMap" }];
  if (pathname === "/alerts") return [root, { key: "alerts" }];
  if (pathname === "/data-compare") return [root, { key: "compare" }];
  if (pathname === "/datasets/new") return [root, { key: "datasets", to: "/datasets" }, { key: "createDataset" }];
  if (/^\/datasets\/[^/]+\/edit$/.test(pathname)) return [root, { key: "datasets", to: "/datasets" }, { key: "editDataset" }];
  if (pathname.startsWith("/datasets/")) return [root, { key: "datasets", to: "/datasets" }, { key: "datasetDetails" }];
  if (pathname === "/datasets") return [root, { key: "datasets" }];
  if (pathname.startsWith("/processing/")) return [root, { key: "processing", to: "/processing" }, { key: "processingDetails" }];
  if (pathname === "/processing") return [root, { key: "processing" }];
  if (pathname === "/exports") return [root, { key: "exports" }];
  if (pathname === "/exports/new") return [root, { key: "exports", to: "/exports" }, { key: "createExport" }];
  if (/^\/wallboards\/[^/]+\/play$/.test(pathname)) return [root, { key: "wallboards", to: "/wallboards" }, { key: "wallboardPlay" }];
  if (pathname === "/wallboards") return [root, { key: "wallboards" }];
  if (pathname === "/settings") return [root, { key: "workspaces", to: "/workspaces" }, { key: "settings" }];
  if (pathname === "/workspaces") return [root, { key: "workspaces" }];
  if (pathname === "/subscription") return [root, { key: "subscription" }];
  if (pathname === "/notifications") return [root, { key: "notifications" }];
  if (pathname === "/account") return [root, { key: "account" }];
  return [root];
}
