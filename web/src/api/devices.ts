import { del, get, patch, post } from "./client";
import type { Device, DeviceChildrenResponse, DeviceListResponse, DeviceRelation } from "./types";

export const devicesApi = {
  list(params: { workspace_id: string; project_id?: string; site_id?: string }): Promise<DeviceListResponse> {
    return get<DeviceListResponse>("/api/v1/devices", params);
  },

  update(deviceId: string, input: Pick<Partial<Device>, "project_id" | "site_id">): Promise<Device> {
    return patch<Device>(`/api/v1/devices/${deviceId}`, input);
  },

  children(deviceId: string): Promise<DeviceChildrenResponse> {
    return get<DeviceChildrenResponse>(`/api/v1/devices/${deviceId}/children`);
  },

  unbind(deviceId: string): Promise<void> {
    return post<void>(`/api/v1/devices/${deviceId}/unbind`, {});
  }
};

export const adminDevicesApi = {
  list(): Promise<DeviceListResponse> {
    return get<DeviceListResponse>("/api/v1/admin/devices");
  },

  assign(
    deviceId: string,
    input: {
      target_workspace_id: string;
      project_id?: string;
      site_id?: string;
      assign_children?: boolean;
    }
  ): Promise<Device> {
    return post<Device>(`/api/v1/admin/devices/${deviceId}/assignment`, input);
  },

  unassign(deviceId: string): Promise<void> {
    return del<void>(`/api/v1/admin/devices/${deviceId}/assignment`);
  },

  children(deviceId: string): Promise<DeviceChildrenResponse> {
    return get<DeviceChildrenResponse>(`/api/v1/admin/devices/${deviceId}/children`);
  },

  addChild(deviceId: string, input: { child_device_id: string }): Promise<DeviceRelation> {
    return post<DeviceRelation>(`/api/v1/admin/devices/${deviceId}/children`, input);
  },

  removeChild(deviceId: string, childDeviceId: string): Promise<DeviceRelation> {
    return del<DeviceRelation>(`/api/v1/admin/devices/${deviceId}/children/${childDeviceId}`);
  }
};
