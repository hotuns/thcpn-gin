import { del, get, post } from "./client";
import type { AccessGrant, AccessGrantListResponse, AccessGrantRoleCode, AccessGrantScopeType } from "./types";

export const accessGrantsApi = {
  list(workspaceId: string): Promise<AccessGrantListResponse> {
    return get<AccessGrantListResponse>("/api/v1/access-grants", { workspace_id: workspaceId });
  },

  listMine(): Promise<AccessGrantListResponse> {
    return get<AccessGrantListResponse>("/api/v1/access-grants/mine");
  },

  create(input: {
    subject_user_id?: string;
    email?: string;
    phone?: string;
    role_code: AccessGrantRoleCode;
    scope_type: AccessGrantScopeType;
    scope_id: string;
    expires_at?: string;
    allow_reshare?: boolean;
    allow_api_access?: boolean;
  }): Promise<AccessGrant> {
    return post<AccessGrant>("/api/v1/access-grants", input);
  },

  revoke(accessGrantId: string): Promise<AccessGrant> {
    return del<AccessGrant>(`/api/v1/access-grants/${accessGrantId}`);
  }
};
