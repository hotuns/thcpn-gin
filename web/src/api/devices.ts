import { get, patch, post } from "./client";
import type { Device, DeviceListResponse } from "./types";

export const devicesApi = {
  list(params: { workspace_id: string; project_id?: string; site_id?: string }): Promise<DeviceListResponse> {
    return get<DeviceListResponse>("/api/v1/devices", params);
  },

  update(deviceId: string, input: Pick<Partial<Device>, "project_id" | "site_id">): Promise<Device> {
    return patch<Device>(`/api/v1/devices/${deviceId}`, input);
  },

  unbind(deviceId: string): Promise<void> {
    return post<void>(`/api/v1/devices/${deviceId}/unbind`, {});
  }
};
