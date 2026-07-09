import { get, patch, post } from "./client";
import type { Camera, CameraBindingStatus, CameraLiveSessionResponse, CameraQuality } from "./types";

export interface CreateCameraInput {
  product_id?: string;
  serial_no: string;
  name: string;
  device_serial: string;
  channel_no?: number;
  default_quality?: CameraQuality;
  is_encrypted?: boolean;
  validate_code_secret_ref?: string;
  target_workspace_id?: string;
  project_id?: string;
  site_id?: string;
}

export interface UpdateCameraInput {
  device_serial?: string;
  channel_no?: number;
  default_quality?: CameraQuality;
  is_encrypted?: boolean;
  validate_code_secret_ref?: string;
  status?: CameraBindingStatus;
}

export const adminCamerasApi = {
  create(input: CreateCameraInput): Promise<Camera> {
    return post<Camera>("/api/v1/admin/cameras", input);
  },

  get(deviceId: string): Promise<Camera> {
    return get<Camera>(`/api/v1/admin/cameras/${deviceId}`);
  },

  update(deviceId: string, input: UpdateCameraInput): Promise<Camera> {
    return patch<Camera>(`/api/v1/admin/cameras/${deviceId}`, input);
  }
};

export const camerasApi = {
  createLiveSession(deviceId: string): Promise<CameraLiveSessionResponse> {
    return post<CameraLiveSessionResponse>(`/api/v1/devices/${deviceId}/camera/live-session`, {});
  }
};
