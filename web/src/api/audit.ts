import { get, type QueryParams } from "./client";
import type { AuditLogListResponse } from "./types";

export const auditApi = {
  list(params: { workspace_id: string; limit?: number }): Promise<AuditLogListResponse> {
    return get<AuditLogListResponse>("/api/v1/audit-logs", params as QueryParams);
  }
};
