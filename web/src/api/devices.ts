import { del, get, patch, post } from "./client";
import type {
  Device,
  DeviceCapabilityDefinition,
  DeviceCapabilityDefinitionListResponse,
  DeviceCapabilityDefinitionStatus,
  DeviceCapabilitiesResponse,
  DeviceCapabilityCode,
  DeviceChildrenResponse,
  DeviceLifecycleResponse,
  DeviceLifecycleStatus,
  DeviceListResponse,
  DeviceRelation,
  SystemRoleDefinition,
  SystemRoleDefinitionListResponse,
  Timestamp
} from "./types";

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

  update(
    deviceId: string,
    input: {
      product_id?: string;
      serial_no?: string;
      name?: string;
      status?: Device["status"];
      device_type?: Device["device_type"];
      capabilities?: DeviceCapabilityCode[];
    }
  ): Promise<Device> {
    return patch<Device>(`/api/v1/admin/devices/${deviceId}`, input);
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

  lifecycle(deviceId: string): Promise<DeviceLifecycleResponse> {
    return get<DeviceLifecycleResponse>(`/api/v1/admin/devices/${deviceId}/lifecycle`);
  },

  updateLifecycle(
    deviceId: string,
    input: {
      lifecycle_status: DeviceLifecycleStatus;
      occurred_at?: Timestamp;
      note?: string;
    }
  ): Promise<DeviceLifecycleResponse> {
    return patch<DeviceLifecycleResponse>(`/api/v1/admin/devices/${deviceId}/lifecycle`, input);
  },

  capabilities(deviceId: string): Promise<DeviceCapabilitiesResponse> {
    return get<DeviceCapabilitiesResponse>(`/api/v1/admin/devices/${deviceId}/capabilities`);
  },

  updateCapabilities(deviceId: string, input: { capabilities: DeviceCapabilityCode[] }): Promise<DeviceCapabilitiesResponse> {
    return patch<DeviceCapabilitiesResponse>(`/api/v1/admin/devices/${deviceId}/capabilities`, input);
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

export const adminDeviceCapabilityDefinitionsApi = {
  list(): Promise<DeviceCapabilityDefinitionListResponse> {
    return get<DeviceCapabilityDefinitionListResponse>("/api/v1/admin/metadata/device-capabilities");
  },

  create(input: {
    code: string;
    name: string;
    status: DeviceCapabilityDefinitionStatus;
    sort_order: number;
  }): Promise<DeviceCapabilityDefinition> {
    return post<DeviceCapabilityDefinition>("/api/v1/admin/metadata/device-capabilities", input);
  },

  update(
    code: string,
    input: {
      name: string;
      status: DeviceCapabilityDefinitionStatus;
      sort_order: number;
    }
  ): Promise<DeviceCapabilityDefinition> {
    return patch<DeviceCapabilityDefinition>(`/api/v1/admin/metadata/device-capabilities/${code}`, input);
  }
};

export const adminSystemRolesApi = {
  list(): Promise<SystemRoleDefinitionListResponse> {
    return get<SystemRoleDefinitionListResponse>("/api/v1/admin/metadata/system-roles");
  },

  update(code: string, input: { name: string }): Promise<SystemRoleDefinition> {
    return patch<SystemRoleDefinition>(`/api/v1/admin/metadata/system-roles/${code}`, input);
  }
};
