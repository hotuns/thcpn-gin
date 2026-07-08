import { del, get, post } from "./client";
import type { Dataset, DatasetDataType, DatasetListResponse, DatasetSourceInput, DatasetTelemetryQueryResponse, ExportJob } from "./types";

export const datasetsApi = {
  list(params: { workspace_id: string; project_id?: string }): Promise<DatasetListResponse> {
    return get<DatasetListResponse>("/api/v1/datasets", params);
  },

  get(datasetId: string): Promise<Dataset> {
    return get<Dataset>(`/api/v1/datasets/${datasetId}`);
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

  queryTelemetry(
    datasetId: string,
    params: {
      start_time?: string;
      end_time?: string;
      limit?: number;
    }
  ): Promise<DatasetTelemetryQueryResponse> {
    return get<DatasetTelemetryQueryResponse>(`/api/v1/datasets/${datasetId}/telemetry`, params);
  },

  exportDataset(
    datasetId: string,
    input?: {
      export_type?: "dataset_zip";
      request_config?: Record<string, unknown>;
      expires_at?: string;
    }
  ): Promise<ExportJob> {
    return post<ExportJob>(`/api/v1/datasets/${datasetId}/export`, input ?? {});
  },

  delete(datasetId: string): Promise<void> {
    return del<void>(`/api/v1/datasets/${datasetId}`);
  }
};
