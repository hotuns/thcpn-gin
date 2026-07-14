export type User = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status?: string;
  is_system_admin?: boolean;
  last_login_at?: string;
};

export type Workspace = {
  id: string;
  name: string;
  type: "personal" | "organization";
  organization_type?: string;
  owner_user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMembership = {
  id: string;
  status: string;
  joined_at: string;
  scope_type: string;
  scope_id: string;
  role: { id: string; code: string; name: string };
};

export type WorkspaceWithMembership = {
  workspace: Workspace;
  membership: WorkspaceMembership;
};

export type AccessibleWorkspace = Workspace & { membership: WorkspaceMembership };

export type Device = {
  id: string;
  workspace_id?: string;
  project_id?: string;
  site_id?: string;
  serial_no: string;
  name: string;
  status: string;
  lifecycle_status: string;
  device_type: string;
  capabilities: string[];
  topology_role: string;
  child_count: number;
  created_at: string;
  updated_at: string;
};

export type DataStream = {
  id: string;
  device_id: string;
  code: string;
  name: string;
  type: string;
  unit?: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type TelemetryPoint = { ts: string; value: number; quality: string };
export type TelemetrySeries = {
  data_stream_id: string;
  code: string;
  name: string;
  unit?: string;
  points: TelemetryPoint[];
  warnings?: Array<{ code: string; message: string; count?: number }>;
};
export type TelemetryQueryResponse = {
  device_id: string;
  start_time: string;
  end_time: string;
  limit: number;
  series: TelemetrySeries[];
};

export type Dataset = {
  id: string;
  workspace_id: string;
  project_id?: string;
  name: string;
  description?: string;
  data_type: string;
  time_start: string;
  time_end: string;
  status: string;
  sources: Array<{ resource_type?: string; resource_id?: string; type?: string; id?: string }>;
  created_at: string;
  updated_at: string;
};

export type ExportJob = {
  id: string;
  workspace_id: string;
  requested_by: string;
  resource_type: string;
  resource_id: string;
  export_type: string;
  status: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  user: User;
  created?: boolean;
};

export type ApiEnvelope<T> = T & { request_id?: string };
export type ListResponse<T> = { items: T[] };
export type JsonRecord = Record<string, unknown>;

const queryString = (values: Record<string, string | number | boolean | undefined | null>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : "";
};

const jsonRequest = <T>(path: string, method: string, body?: unknown) => request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export class ApiError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, requestId?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

type TokenPair = { accessToken: string; refreshToken: string };

const tokenKey = "thcpn.auth.tokens";
const baseUrl = (((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL) ?? "");

export const authStorage = {
  read(): TokenPair | null {
    try {
      const raw = localStorage.getItem(tokenKey);
      return raw ? (JSON.parse(raw) as TokenPair) : null;
    } catch {
      return null;
    }
  },
  write(tokens: TokenPair) {
    localStorage.setItem(tokenKey, JSON.stringify(tokens));
  },
  clear() {
    localStorage.removeItem(tokenKey);
  }
};

const parseResponse = async (response: Response) => {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const text = await response.text();
  let body: any = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? body?.error ?? response.statusText ?? "请求失败";
    throw new ApiError(String(message), response.status, body?.request_id ?? requestId, body);
  }
  return { body, requestId };
};

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const tokens = authStorage.read();
  if (tokens?.accessToken) headers.set("Authorization", `Bearer ${tokens.accessToken}`);

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  try {
    const { body } = await parseResponse(response);
    return body as T;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && retry && tokens?.refreshToken) {
      try {
        const refreshed = await request<LoginResponse>("/api/v1/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refresh_token: tokens.refreshToken })
        }, false);
        authStorage.write({ accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token });
        return request<T>(path, init, false);
      } catch {
        authStorage.clear();
      }
    }
    throw error;
  }
}

async function download(path: string): Promise<Blob> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    await parseResponse(response);
    throw new ApiError("下载失败", response.status);
  }
  return response.blob();
}

export const formatApiError = (error: unknown) => {
  if (error instanceof ApiError) {
    return { message: error.message, requestId: error.requestId, status: error.status };
  }
  return { message: error instanceof Error ? error.message : "网络连接失败", requestId: undefined, status: 0 };
};

export const api = {
  health: () => request<{ status: string }>("/healthz", {}, false),
  ready: () => request<{ status: string }>("/readyz", {}, false),
  metrics: () => request<string>("/metrics", {}, false),
  downloadSignedObject: (params: JsonRecord) => download(`/api/v1/objects/download${queryString(params as Record<string, string | number | boolean>)}`),
  auth: {
    login: (payload: { identifier: string; password: string; mfa_code?: string }) => request<LoginResponse>("/api/v1/auth/password/login", { method: "POST", body: JSON.stringify(payload) }, false),
    register: (payload: { name: string; phone?: string; email?: string; password: string }) => request<LoginResponse>("/api/v1/auth/password/register", { method: "POST", body: JSON.stringify(payload) }, false),
    smsSend: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/auth/sms/send", "POST", payload),
    smsLogin: (payload: JsonRecord) => jsonRequest<LoginResponse>("/api/v1/auth/sms/login", "POST", payload),
    devRegister: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/auth/register", "POST", payload),
    refresh: (refreshToken: string) => jsonRequest<LoginResponse>("/api/v1/auth/refresh", "POST", { refresh_token: refreshToken }),
    logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }, false),
    sessions: () => request<ListResponse<JsonRecord>>("/api/v1/auth/sessions"),
    revokeSession: (id: string) => request<void>(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    sendEmailCode: () => jsonRequest<JsonRecord>("/api/v1/auth/email/send", "POST", {}),
    verifyEmailCode: (code: string) => jsonRequest<JsonRecord>("/api/v1/auth/email/verify", "POST", { code }),
    mfaStatus: () => request<JsonRecord>("/api/v1/auth/mfa"),
    mfaSetup: () => jsonRequest<JsonRecord>("/api/v1/auth/mfa/totp/setup", "POST", {}),
    mfaEnable: (code: string) => jsonRequest<JsonRecord>("/api/v1/auth/mfa/totp/enable", "POST", { code }),
    mfaDisable: (code: string) => jsonRequest<void>("/api/v1/auth/mfa/totp", "DELETE", { code })
  },
  me: () => request<{ user: User }>("/api/v1/me"),
  workspaces: {
    list: () => request<ListResponse<WorkspaceWithMembership>>("/api/v1/workspaces"),
    create: (payload: { name: string; organization_type: string }) => request<WorkspaceWithMembership>("/api/v1/workspaces", { method: "POST", body: JSON.stringify(payload) }),
    adminList: () => request<ListResponse<JsonRecord>>("/api/v1/admin/workspaces")
  },
  projects: {
    list: (workspaceId: string) => request<ListResponse<JsonRecord>>(`/api/v1/projects${queryString({ workspace_id: workspaceId })}`),
    adminList: (workspaceId?: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/projects${queryString({ workspace_id: workspaceId })}`),
    get: (id: string) => request<JsonRecord>(`/api/v1/projects/${encodeURIComponent(id)}`),
    create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/projects", "POST", payload),
    update: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/projects/${encodeURIComponent(id)}`, "PATCH", payload)
  },
  sites: {
    list: (workspaceId: string, projectId?: string) => request<ListResponse<JsonRecord>>(`/api/v1/sites${queryString({ workspace_id: workspaceId, project_id: projectId })}`),
    adminList: (workspaceId?: string, projectId?: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/sites${queryString({ workspace_id: workspaceId, project_id: projectId })}`),
    get: (id: string) => request<JsonRecord>(`/api/v1/sites/${encodeURIComponent(id)}`),
    create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/sites", "POST", payload),
    update: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/sites/${encodeURIComponent(id)}`, "PATCH", payload)
  },
  members: {
    list: (workspaceId: string) => request<ListResponse<JsonRecord>>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`),
    add: (workspaceId: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`, "POST", payload),
    update: (workspaceId: string, memberId: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`, "PATCH", payload),
    remove: (workspaceId: string, memberId: string) => request<void>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" })
  },
  permissions: {
    catalog: () => request<JsonRecord>("/api/v1/permissions/catalog")
  },
  devices: {
    list: (workspaceId: string, filters: { projectId?: string; siteId?: string } = {}) => {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (filters.projectId) params.set("project_id", filters.projectId);
      if (filters.siteId) params.set("site_id", filters.siteId);
      return request<ListResponse<Device>>(`/api/v1/devices?${params}`);
    },
    get: (id: string) => request<Device>(`/api/v1/devices/${encodeURIComponent(id)}`),
    update: (id: string, payload: JsonRecord) => jsonRequest<Device>(`/api/v1/devices/${encodeURIComponent(id)}`, "PATCH", payload),
    children: (id: string) => request<ListResponse<Device>>(`/api/v1/devices/${encodeURIComponent(id)}/children`),
    liveSession: (id: string, payload: JsonRecord = {}) => jsonRequest<JsonRecord>(`/api/v1/devices/${encodeURIComponent(id)}/camera/live-session`, "POST", payload),
    calibrate: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/devices/${encodeURIComponent(id)}/calibrations`, "POST", payload),
    firmwareUpgrade: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/devices/${encodeURIComponent(id)}/firmware-upgrades`, "POST", payload),
    transfer: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/devices/${encodeURIComponent(id)}/transfer`, "POST", payload),
    unbind: (id: string) => request<void>(`/api/v1/devices/${encodeURIComponent(id)}/unbind`, { method: "DELETE" })
  },
  dataStreams: {
    list: (deviceId: string) => request<ListResponse<DataStream>>(`/api/v1/data-streams?device_id=${encodeURIComponent(deviceId)}`),
    get: (id: string) => request<DataStream>(`/api/v1/data-streams/${encodeURIComponent(id)}`)
  },
  telemetry: {
    device: (deviceId: string, input: { startTime: string; endTime: string; limit?: number }) => {
      const params = new URLSearchParams({ start_time: input.startTime, end_time: input.endTime });
      if (input.limit) params.set("limit", String(input.limit));
      return request<TelemetryQueryResponse>(`/api/v1/devices/${encodeURIComponent(deviceId)}/telemetry?${params}`);
    },
    dataStream: (id: string, input: { startTime: string; endTime: string; limit?: number }) => request<TelemetryQueryResponse>(`/api/v1/data-streams/${encodeURIComponent(id)}/telemetry${queryString({ start_time: input.startTime, end_time: input.endTime, limit: input.limit })}`),
    dataset: (id: string, input: { startTime?: string; endTime?: string; limit?: number } = {}) => request<JsonRecord>(`/api/v1/datasets/${encodeURIComponent(id)}/telemetry${queryString({ start_time: input.startTime, end_time: input.endTime, limit: input.limit })}`)
  },
  media: {
    device: (id: string, input: JsonRecord) => request<JsonRecord>(`/api/v1/devices/${encodeURIComponent(id)}/media${queryString(input as Record<string, string | number | boolean>)}`),
    images: (id: string, input: JsonRecord) => request<JsonRecord>(`/api/v1/devices/${encodeURIComponent(id)}/media/images${queryString(input as Record<string, string | number | boolean>)}`),
    videos: (id: string, input: JsonRecord) => request<JsonRecord>(`/api/v1/devices/${encodeURIComponent(id)}/media/videos${queryString(input as Record<string, string | number | boolean>)}`),
    dataStream: (id: string, input: JsonRecord) => request<JsonRecord>(`/api/v1/data-streams/${encodeURIComponent(id)}/media${queryString(input as Record<string, string | number | boolean>)}`),
    prepareDownload: (payload: JsonRecord) => request<JsonRecord>(`/api/v1/media/download${queryString({ token: String(payload.token ?? "") })}`),
    remove: (payload: JsonRecord) => request<JsonRecord>(`/api/v1/media${queryString({ token: String(payload.token ?? "") })}`, { method: "DELETE" })
  },
  datasets: {
    list: (workspaceId: string, projectId?: string) => request<ListResponse<Dataset>>(`/api/v1/datasets${queryString({ workspace_id: workspaceId, project_id: projectId })}`),
    get: (id: string) => request<Dataset>(`/api/v1/datasets/${encodeURIComponent(id)}`),
    create: (payload: JsonRecord) => jsonRequest<Dataset>("/api/v1/datasets", "POST", payload),
    update: (id: string, payload: JsonRecord) => jsonRequest<Dataset>(`/api/v1/datasets/${encodeURIComponent(id)}`, "PATCH", payload),
    remove: (id: string) => request<void>(`/api/v1/datasets/${encodeURIComponent(id)}`, { method: "DELETE" }),
    export: (id: string, payload: JsonRecord = {}) => jsonRequest<ExportJob>(`/api/v1/datasets/${encodeURIComponent(id)}/export`, "POST", payload)
  },
  exports: {
    list: (workspaceId?: string, mine = true, limit = 100) => request<ListResponse<ExportJob>>(`/api/v1/export-jobs${queryString({ workspace_id: workspaceId, mine, limit })}`),
    get: (id: string) => request<ExportJob>(`/api/v1/export-jobs/${encodeURIComponent(id)}`),
    create: (payload: JsonRecord) => jsonRequest<ExportJob>("/api/v1/export-jobs", "POST", payload),
    download: (id: string) => request<JsonRecord>(`/api/v1/export-jobs/${encodeURIComponent(id)}/download`)
  },
  accessGrants: {
    list: (workspaceId?: string) => request<ListResponse<JsonRecord>>(`/api/v1/access-grants${queryString({ workspace_id: workspaceId })}`),
    mine: () => request<ListResponse<JsonRecord>>("/api/v1/access-grants/mine"),
    create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/access-grants", "POST", payload),
    revoke: (id: string) => request<void>(`/api/v1/access-grants/${encodeURIComponent(id)}`, { method: "DELETE" })
  },
  invitations: {
    list: (workspaceId?: string) => request<ListResponse<JsonRecord>>(`/api/v1/invitations${queryString({ workspace_id: workspaceId })}`),
    mine: () => request<ListResponse<JsonRecord>>("/api/v1/invitations/mine"),
    create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/invitations", "POST", payload),
    accept: (id: string) => jsonRequest<JsonRecord>(`/api/v1/invitations/${encodeURIComponent(id)}/accept`, "POST", {}),
    revoke: (id: string) => request<void>(`/api/v1/invitations/${encodeURIComponent(id)}`, { method: "DELETE" })
  },
  audit: {
    list: (workspaceId: string, limit = 100) => request<ListResponse<JsonRecord>>(`/api/v1/audit-logs${queryString({ workspace_id: workspaceId, limit })}`)
  },
  admin: {
    sources: () => request<ListResponse<Record<string, unknown>>>("/api/v1/admin/data-sources"),
    createSource: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/data-sources", "POST", payload),
    updateSource: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/data-sources/${encodeURIComponent(id)}`, "PATCH", payload),
    syncStation: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/data-sources/${encodeURIComponent(id)}/thcpn-standard-station/devices`, "POST", payload),
    syncGateway: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/data-sources/${encodeURIComponent(id)}/thcpn-standard-station/gateways`, "POST", payload),
    devices: () => request<ListResponse<Record<string, unknown>>>("/api/v1/admin/devices"),
    updateDevice: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}`, "PATCH", payload),
    deviceChildren: (id: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/devices/${encodeURIComponent(id)}/children`),
    addDeviceChild: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}/children`, "POST", payload),
    removeDeviceChild: (id: string, childId: string) => request<void>(`/api/v1/admin/devices/${encodeURIComponent(id)}/children/${encodeURIComponent(childId)}`, { method: "DELETE" }),
    deviceConfig: (id: string) => request<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}/thcpn-config`),
    updateDeviceConfig: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}/thcpn-config`, "POST", payload),
    lifecycle: (id: string) => request<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}/lifecycle`),
    updateLifecycle: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}/lifecycle`, "PATCH", payload),
    capabilities: (id: string) => request<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}/capabilities`),
    updateCapabilities: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}/capabilities`, "PATCH", payload),
    assignDevice: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/devices/${encodeURIComponent(id)}/assignment`, "POST", payload),
    unassignDevice: (id: string) => request<void>(`/api/v1/admin/devices/${encodeURIComponent(id)}/assignment`, { method: "DELETE" }),
    createCamera: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/cameras", "POST", payload),
    camera: (id: string) => request<JsonRecord>(`/api/v1/admin/cameras/${encodeURIComponent(id)}`),
    updateCamera: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/cameras/${encodeURIComponent(id)}`, "PATCH", payload),
    metadata: () => request<ListResponse<Record<string, unknown>>>("/api/v1/admin/metadata/device-capabilities"),
    createCapabilityDefinition: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/metadata/device-capabilities", "POST", payload),
    updateCapabilityDefinition: (code: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/metadata/device-capabilities/${encodeURIComponent(code)}`, "PATCH", payload),
    roles: () => request<ListResponse<JsonRecord>>("/api/v1/admin/metadata/system-roles"),
    updateRole: (code: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/metadata/system-roles/${encodeURIComponent(code)}`, "PATCH", payload)
  }
};

export { request };
