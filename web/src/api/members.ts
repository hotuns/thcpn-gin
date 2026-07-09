import { del, get, patch, post } from "./client";
import type { MemberScopeType, PermissionCode, WorkspaceMember, WorkspaceMemberListResponse } from "./types";

export const membersApi = {
  list(workspaceId: string): Promise<WorkspaceMemberListResponse> {
    return get<WorkspaceMemberListResponse>(`/api/v1/workspaces/${workspaceId}/members`);
  },

  add(
    workspaceId: string,
    input: {
      user_id?: string;
      email?: string;
      phone?: string;
      template_code?: string;
      permission_codes: PermissionCode[];
      scope_type?: MemberScopeType;
      scope_id?: string;
    }
  ): Promise<WorkspaceMember> {
    return post<WorkspaceMember>(`/api/v1/workspaces/${workspaceId}/members`, input);
  },

  updateRole(
    workspaceId: string,
    memberId: string,
    input: {
      template_code?: string;
      permission_codes: PermissionCode[];
      scope_type?: MemberScopeType;
      scope_id?: string;
    }
  ): Promise<WorkspaceMember> {
    return patch<WorkspaceMember>(`/api/v1/workspaces/${workspaceId}/members/${memberId}`, {
      ...input
    });
  },

  remove(workspaceId: string, memberId: string): Promise<void> {
    return del<void>(`/api/v1/workspaces/${workspaceId}/members/${memberId}`);
  }
};
