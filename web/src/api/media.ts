import { get, type QueryParams } from "./client";
import type { MediaListResponse, MediaType } from "./types";

export type MediaQueryParams = QueryParams & {
  start_time: string;
  end_time: string;
  media_type?: MediaType;
  page?: number;
  page_size?: number;
};

export const mediaApi = {
  listDevice(deviceId: string, params: MediaQueryParams): Promise<MediaListResponse> {
    return get<MediaListResponse>(`/api/v1/devices/${deviceId}/media`, params);
  },

  listDeviceImages(deviceId: string, params: Omit<MediaQueryParams, "media_type">): Promise<MediaListResponse> {
    return get<MediaListResponse>(`/api/v1/devices/${deviceId}/media/images`, params);
  },

  listDataStream(dataStreamId: string, params: Omit<MediaQueryParams, "media_type">): Promise<MediaListResponse> {
    return get<MediaListResponse>(`/api/v1/data-streams/${dataStreamId}/media`, params);
  }
};
