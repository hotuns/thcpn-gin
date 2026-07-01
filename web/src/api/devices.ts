import { get, patch, post } from "./client";
import type { Device, DeviceCapabilityCode, DeviceListResponse } from "./types";

export const devicesApi = {
  list(params: { workspace_id: string; project_id?: string; site_id?: string }): Promise<DeviceListResponse> {
    return get<DeviceListResponse>("/api/v1/devices", params);
  },

  create(input: {
    workspace_id: string;
    project_id?: string;
    site_id?: string;
    product_id?: string;
    serial_no: string;
    name: string;
    capabilities?: DeviceCapabilityCode[];
  }): Promise<Device> {
    return post<Device>("/api/v1/devices", input);
  },

  update(deviceId: string, input: Partial<Device>): Promise<Device> {
    return patch<Device>(`/api/v1/devices/${deviceId}`, input);
  },

  unbind(deviceId: string): Promise<Device> {
    return post<Device>(`/api/v1/devices/${deviceId}/unbind`, {});
  }
};
