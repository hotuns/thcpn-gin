import { get } from "./client";
import type { DataStreamListResponse } from "./types";

export const dataStreamsApi = {
  list(deviceId: string): Promise<DataStreamListResponse> {
    return get<DataStreamListResponse>("/api/v1/data-streams", { device_id: deviceId });
  }
};
