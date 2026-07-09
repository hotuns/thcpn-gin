import { get } from "./client";
import type { PermissionCatalogResponse } from "./types";

export const permissionsApi = {
  catalog(): Promise<PermissionCatalogResponse> {
    return get<PermissionCatalogResponse>("/api/v1/permissions/catalog");
  }
};
