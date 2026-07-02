import { get, type QueryParams } from "./client";
import type { TelemetryQueryResponse } from "./types";

export type TelemetryQueryParams = QueryParams & {
  start_time: string;
  end_time: string;
  limit?: number;
};

export const telemetryApi = {
  queryDevice(deviceId: string, params: TelemetryQueryParams): Promise<TelemetryQueryResponse> {
    return get<TelemetryQueryResponse>(`/api/v1/devices/${deviceId}/telemetry`, params);
  },

  queryDataStream(dataStreamId: string, params: TelemetryQueryParams): Promise<TelemetryQueryResponse> {
    return get<TelemetryQueryResponse>(`/api/v1/data-streams/${dataStreamId}/telemetry`, params);
  }
};
