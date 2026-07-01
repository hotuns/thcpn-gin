import { get, post } from "./client";
import type { DataSource, DataSourceListResponse, DataSourceType } from "./types";

export const dataSourcesApi = {
  list(workspaceId: string): Promise<DataSourceListResponse> {
    return get<DataSourceListResponse>("/api/v1/data-sources", { workspace_id: workspaceId });
  },

  create(input: {
    workspace_id: string;
    name: string;
    type: DataSourceType;
    dsn_secret_ref: string;
  }): Promise<DataSource> {
    return post<DataSource>("/api/v1/data-sources", input);
  }
};
