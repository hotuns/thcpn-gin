import { get, post } from "./client";
import type { OrganizationType, WorkspaceListResponse, WorkspaceWithMembership } from "./types";

export const workspacesApi = {
  list(): Promise<WorkspaceListResponse> {
    return get<WorkspaceListResponse>("/api/v1/workspaces");
  },

  create(input: { name: string; organization_type: OrganizationType }): Promise<WorkspaceWithMembership> {
    return post<WorkspaceWithMembership>("/api/v1/workspaces", input);
  }
};
