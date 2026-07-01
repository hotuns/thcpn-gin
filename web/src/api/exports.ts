import { get, post } from "./client";
import type { ExportDownloadResponse, ExportJob, ExportJobListResponse, ExportResourceType, ExportType } from "./types";

export const exportJobsApi = {
  list(params: { workspace_id?: string; mine?: boolean; limit?: number }): Promise<ExportJobListResponse> {
    return get<ExportJobListResponse>("/api/v1/export-jobs", params);
  },

  create(input: {
    resource_type: ExportResourceType;
    resource_id: string;
    export_type: ExportType;
    start_time?: string;
    end_time?: string;
    limit?: number;
    request_config?: Record<string, unknown>;
    expires_at?: string;
  }): Promise<ExportJob> {
    return post<ExportJob>("/api/v1/export-jobs", input);
  },

  prepareDownload(exportJobId: string): Promise<ExportDownloadResponse> {
    return get<ExportDownloadResponse>(`/api/v1/export-jobs/${exportJobId}/download`);
  }
};
