import { get, patch, post } from "./client";
import type {
  DataSource,
  DataSourceListResponse,
  DataSourceStatus,
  DataSourceType,
  SyncTHCPNStandardStationRequest,
  THCPNStandardStationSyncResult
} from "./types";

export const adminDataSourcesApi = {
  list(): Promise<DataSourceListResponse> {
    return get<DataSourceListResponse>("/api/v1/admin/data-sources");
  },

  create(input: {
    name: string;
    type: DataSourceType;
    dsn_secret_ref: string;
  }): Promise<DataSource> {
    return post<DataSource>("/api/v1/admin/data-sources", input);
  },

  update(
    dataSourceId: string,
    input: Partial<{
      name: string;
      type: DataSourceType;
      dsn_secret_ref: string;
      status: DataSourceStatus;
    }>
  ): Promise<DataSource> {
    return patch<DataSource>(`/api/v1/admin/data-sources/${dataSourceId}`, input);
  },

  syncTHCPNStandardStationDevice(
    dataSourceId: string,
    input: SyncTHCPNStandardStationRequest
  ): Promise<THCPNStandardStationSyncResult> {
    return post<THCPNStandardStationSyncResult>(
      `/api/v1/admin/data-sources/${dataSourceId}/thcpn-standard-station/devices`,
      input
    );
  }
};
