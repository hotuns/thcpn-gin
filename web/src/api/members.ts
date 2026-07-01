import { del, get, patch, post } from "./client";
import type { InternalMemberRoleCode, WorkspaceMember, WorkspaceMemberListResponse } from "./types";

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
      role_code: InternalMemberRoleCode;
    }
  ): Promise<WorkspaceMember> {
    return post<WorkspaceMember>(`/api/v1/workspaces/${workspaceId}/members`, input);
  },

  updateRole(workspaceId: string, memberId: string, roleCode: InternalMemberRoleCode): Promise<WorkspaceMember> {
    return patch<WorkspaceMember>(`/api/v1/workspaces/${workspaceId}/members/${memberId}`, {
      role_code: roleCode
    });
  },

  remove(workspaceId: string, memberId: string): Promise<void> {
    return del<void>(`/api/v1/workspaces/${workspaceId}/members/${memberId}`);
  }
};
