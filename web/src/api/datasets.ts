import { del, get, post } from "./client";
import type { Dataset, DatasetDataType, DatasetListResponse, DatasetSourceInput } from "./types";

export const datasetsApi = {
  list(params: { workspace_id: string; project_id?: string }): Promise<DatasetListResponse> {
    return get<DatasetListResponse>("/api/v1/datasets", params);
  },

  create(input: {
    workspace_id: string;
    project_id?: string;
    name: string;
    description?: string;
    data_type: DatasetDataType;
    time_start: string;
    time_end: string;
    sources: DatasetSourceInput[];
  }): Promise<Dataset> {
    return post<Dataset>("/api/v1/datasets", input);
  },

  delete(datasetId: string): Promise<void> {
    return del<void>(`/api/v1/datasets/${datasetId}`);
  }
};
