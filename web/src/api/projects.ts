import { get, patch, post } from "./client";
import type { Project, ProjectListResponse } from "./types";

export const projectsApi = {
  list(workspaceId: string): Promise<ProjectListResponse> {
    return get<ProjectListResponse>("/api/v1/projects", { workspace_id: workspaceId });
  },

  create(input: { workspace_id: string; name: string; description?: string }): Promise<Project> {
    return post<Project>("/api/v1/projects", input);
  },

  update(projectId: string, input: Partial<Pick<Project, "name" | "description" | "status">>): Promise<Project> {
    return patch<Project>(`/api/v1/projects/${projectId}`, input);
  }
};

export const adminProjectsApi = {
  list(workspaceId: string): Promise<ProjectListResponse> {
    return get<ProjectListResponse>("/api/v1/admin/projects", { workspace_id: workspaceId });
  }
};
