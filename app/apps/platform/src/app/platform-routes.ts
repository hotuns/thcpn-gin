import { generatePath, matchPath, parsePath } from "react-router-dom";
import { platformEdition } from "./edition";

type RouteMetadata = {
  key: string;
  parent?: string;
  mobileParent?: string;
  mobileSection?: "overview" | "devices" | "alerts" | "data" | "more";
  editor?: "create" | "edit";
  presentation?: "workbench" | "immersive";
};

const routes: Record<string, RouteMetadata> = {
  "/dashboard": { key: "overview", mobileSection: "overview" },
  "/data": { key: "dataHub", mobileSection: "data" },
  "/more": { key: "more" },
  "/devices": { key: "devices", mobileSection: "devices" },
  "/devices/:deviceId": { key: "deviceDetails", parent: "/devices", mobileSection: "devices" },
  "/claim/:claimSlug?": { key: "claimDevice", parent: "/devices", mobileSection: "devices" },
  "/device-map": { key: "deviceMap", mobileParent: "/more", presentation: "workbench" },
  "/alerts": { key: "alerts", mobileSection: "alerts" },
  "/data-compare": { key: "compare", mobileParent: "/data", mobileSection: "data" },
  "/datasets": { key: "datasets", mobileParent: "/data", mobileSection: "data" },
  "/datasets/new": { key: "createDataset", parent: "/datasets", editor: "create", mobileSection: "data" },
  "/datasets/:datasetId/edit": { key: "editDataset", parent: "/datasets/:datasetId", editor: "edit", mobileSection: "data" },
  "/datasets/:datasetId": { key: "datasetDetails", parent: "/datasets", mobileSection: "data" },
  "/processing": { key: "processing", mobileParent: "/data", mobileSection: "data" },
  "/processing/new": { key: "createProcessing", parent: "/processing", editor: "create", mobileSection: "data" },
  "/processing/:taskId": { key: "processingDetails", parent: "/processing", mobileSection: "data" },
  "/exports": { key: "exports", mobileParent: "/data", mobileSection: "data" },
  "/exports/new": { key: "createExport", parent: "/exports", editor: "create", mobileSection: "data" },
  "/atlas": { key: "wallboards", mobileParent: "/more" },
  "/atlas/topics/digital-plot": { key: "digitalPlot", parent: "/atlas?tab=topics", presentation: "immersive" },
  "/atlas/:id": { key: "atlasView", parent: "/atlas", presentation: "immersive" },
  "/workspaces": { key: "workspaces", mobileParent: "/more" },
  "/settings": { key: "settings", parent: "/workspaces" },
  "/subscription": { key: "subscription", parent: "/workspaces" },
  "/notifications": { key: "notifications", parent: "/dashboard", mobileSection: "alerts" },
  "/account": { key: "account", mobileParent: "/more" },
};

export function findPlatformRoute(pathname: string): RouteMetadata | undefined {
  for (const [pattern, metadata] of Object.entries(routes)) {
    const match = matchPath(pattern, pathname);
    if (match) {
      const parentPattern = platformEdition.lite && pattern === "/settings" ? undefined : metadata.parent;
      return {
        ...metadata,
        parent: parentPattern ? generatePath(parentPattern, match.params) : undefined,
      };
    }
  }
}

export function platformBreadcrumbs(pathname: string) {
  const items: { key: string; to?: string }[] = [];
  let path: string | undefined = pathname;
  let to: string | undefined;
  while (path) {
    const route = findPlatformRoute(parsePath(path).pathname ?? "");
    if (!route) break;
    items.unshift({ key: route.key, to });
    path = route.parent;
    to = path;
  }
  return items;
}
