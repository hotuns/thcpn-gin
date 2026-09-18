import { workspaceQueryKey } from "@thcpn/workspace";

export const DEVICE_LIST_STALE_TIME = 5 * 60_000;
export const DEVICE_LIST_GC_TIME = 60 * 60_000;

export const deviceListQueryKey = (
  workspaceId: string | null,
  projectId = "",
  siteId = "",
) =>
  projectId || siteId
    ? workspaceQueryKey(
        workspaceId,
        "devices",
        projectId || "all",
        siteId || "all",
      )
    : workspaceQueryKey(workspaceId, "devices");
