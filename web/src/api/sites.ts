import { get, post } from "./client";
import type { Site, SiteListResponse } from "./types";

export const sitesApi = {
  list(params: { workspace_id: string; project_id?: string }): Promise<SiteListResponse> {
    return get<SiteListResponse>("/api/v1/sites", params);
  },

  create(input: {
    workspace_id: string;
    project_id: string;
    name: string;
    description?: string;
    location_text?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<Site> {
    return post<Site>("/api/v1/sites", input);
  }
};
