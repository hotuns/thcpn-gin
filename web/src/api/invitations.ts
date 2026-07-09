import { del, get, post } from "./client";
import type { AccessGrant, AccessGrantScopeType, Invitation, InvitationListResponse, PermissionCode } from "./types";

export const invitationsApi = {
  list(workspaceId: string): Promise<InvitationListResponse> {
    return get<InvitationListResponse>("/api/v1/invitations", { workspace_id: workspaceId });
  },

  listMine(): Promise<InvitationListResponse> {
    return get<InvitationListResponse>("/api/v1/invitations/mine");
  },

  create(input: {
    email?: string;
    phone?: string;
    template_code?: string;
    permission_codes: PermissionCode[];
    scope_type: AccessGrantScopeType;
    scope_id: string;
    expires_at?: string;
  }): Promise<Invitation> {
    return post<Invitation>("/api/v1/invitations", input);
  },

  accept(invitationId: string): Promise<AccessGrant> {
    return post<AccessGrant>(`/api/v1/invitations/${invitationId}/accept`, {});
  },

  revoke(invitationId: string): Promise<Invitation> {
    return del<Invitation>(`/api/v1/invitations/${invitationId}`);
  }
};
