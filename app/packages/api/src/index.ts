import type { components } from "./openapi";
export * from "./display-labels";
export * from "./sampling-profile";

type Schema<Name extends keyof components["schemas"]> =
  components["schemas"][Name];

export type User = Schema<"UserProfile">;
export type SendCodeResponse = Schema<"SendCodeResponse">;
export type MfaStatus = Schema<"MfaStatusResponse">;
export type TotpSetup = Schema<"TotpSetupResponse">;
export type AuthSession = Schema<"AuthSession">;
export type Workspace = Schema<"Workspace">;
export type WorkspaceMembership = Schema<"WorkspaceMembership">;
export type WorkspaceWithMembership = Schema<"WorkspaceWithMembership">;
export type WorkspaceMember = Schema<"WorkspaceMember">;
export type WorkspaceBillingSummary = Schema<"WorkspaceBillingSummary">;
export type WorkspaceApiKey = Schema<"WorkspaceApiKey">;
export type WorkspaceApiKeyCreated = Schema<"CreatedWorkspaceApiKey">;

export type AccessibleWorkspace = Workspace & {
  membership: WorkspaceMembership;
};

export type Device = Omit<Schema<"Device">, "device_type"> & { device_type: string };
export type DeviceProfile = Schema<"DeviceProfile">;
export type DeviceProfileImage = Schema<"DeviceProfileImage">;
export type DeviceTaxonomyTerm = { id: string; kind: "ecosystem" | "observation_object" | "purpose" | "management" | "deployment"; code: string; name_zh: string; name_en: string; parent_id?: string; status: "active" | "inactive"; sort_order: number; system_defined: boolean; icon?: string };
export type DeviceEnvironmentValues = { ecosystem?: DeviceTaxonomyTerm; observation_objects: DeviceTaxonomyTerm[]; purposes: DeviceTaxonomyTerm[]; management?: DeviceTaxonomyTerm; deployment?: DeviceTaxonomyTerm; altitude_m?: number; commissioned_year?: number; research_tags: string[] };
export type DeviceEnvironment = { device_id: string; direct: DeviceEnvironmentValues; effective: DeviceEnvironmentValues; overridden_fields: string[]; sources: Record<string, string>; parent_device_id?: string; site_id?: string; updated_at?: string };
export type SiteEnvironment = { site_id: string; values: DeviceEnvironmentValues; updated_at?: string };
export type DeviceMapItem = { device_id: string; name: string; serial_no: string; device_type: string; status: string; workspace_id?: string; site_id?: string; latitude?: number; longitude?: number; location_source: string; child_count: number; environment: DeviceEnvironmentValues };
export type DeviceMapResult = { items: DeviceMapItem[]; total: number; located: number; unlocated: number; unclassified: number };
export type DeviceChild = Schema<"DeviceChild">;
export type DataStream = Schema<"DataStream"> & { computed?: boolean };
export type DeviceMetadata = {
  id: string;
  device_id: string;
  key: string;
  name: string;
  value_type: "number" | "string" | "boolean";
  value: number | string | boolean;
  unit?: string;
  created_at: string;
  updated_at: string;
};
export type DeviceMetadataInput = Pick<DeviceMetadata, "key" | "name" | "value_type" | "value"> & { unit?: string };
export type ComputedDataStream = {
  data_stream_id: string;
  device_id: string;
  code: string;
  name: string;
  unit?: string;
  status: "active" | "disabled" | "archived";
  formula: string;
  referenced_stream_codes: string[];
  referenced_metadata_keys: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
export type TelemetryPoint = Schema<"TelemetryPoint">;
export type TelemetrySeries = Schema<"TelemetrySeries">;
export type TelemetryQueryResponse = Schema<"TelemetryQueryResponse">;
export type MediaItem = Schema<"MediaItem">;
export type MediaListResponse = Schema<"MediaListResponse">;
export type CameraLiveSession = Schema<"CameraLiveSessionResponse">;
export type Dataset = Schema<"Dataset">;
export type ExportJob = Schema<"ExportJob">;
export type THCPNLatestAttributesResponse = Schema<"THCPNLatestAttributesResponse">;
export type THCPNDeviceRuntimeBatchResponse = Schema<"THCPNDeviceRuntimeBatchResponse">;
export type THCPNDeviceLogListResponse = Schema<"THCPNDeviceLogListResponse">;
export type THCPNDeviceLogAccessResponse = Schema<"THCPNDeviceLogAccessResponse">;
export type THCPNSensorTemplate = Schema<"THCPNSensorTemplate">;
export type THCPNSensorMetric = Schema<"THCPNSensorMetric">;
export type THCPNSensorTemplateListResponse = Schema<"THCPNSensorTemplateListResponse">;
export type SensorTemplateRequest = Schema<"SensorTemplateRequest">;
export type SamplingProfile = Schema<"SamplingProfileResponse">;
export type UpdateSamplingProfile = Schema<"UpdateSamplingProfileRequest">;
export type DevicePublicAccess = Schema<"DevicePublicAccess">;
export type PublicDevice = Schema<"PublicDevice">;
export type PublicDeviceStream = Schema<"PublicDeviceStream">;
export type DeviceClaimCredential = {
  device_id: string;
  device_name: string;
  device_type: string;
  serial_no: string;
  claim_slug?: string;
  claim_path?: string;
  manual_code?: string;
  printed_at?: string;
  created_at: string;
  child_count: number;
  is_assigned: boolean;
  is_claimable: boolean;
};
export type DeviceClaimResult = {
  device_id: string;
  assignment_id: string;
  workspace_id: string;
  device_name: string;
  device_type: string;
  child_count: number;
};
export type LoginResponse = Schema<"LoginResponse">;
export type AdminUser = {
  id: string;
  name: string;
  email: string;
  status: "active" | "disabled";
  last_login_at?: string;
  created_at?: string;
  updated_at?: string;
};
export type AdminLoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in: number;
  admin: AdminUser;
};

export type ApiEnvelope<T> = T & { request_id?: string };
export type ListResponse<T> = { items: T[]; total?: number; page?: number; page_size?: number };
export type JsonRecord = Record<string, unknown>;
export type ProcessingProcessor = {
  code: string; version: string; name: string; description: string;
  manifest: { inputs?: Array<{ code: string; name: string; kind: string; required?: boolean; ui?: { calibration_board?: { required?: boolean; shape?: "rectangle"; label?: string } } }>; outputs?: Array<{ code: string; name: string; kind: string; unit?: string }>; triggers?: string[]; parameters?: JsonRecord };
  enabled: boolean; synced_at: string;
};
export type ProcessingTask = {
  id: string; workspace_id: string; name: string; description: string;
  target_type: "device" | "site"; target_id: string; target_name: string;
  status: "active" | "paused" | "archived"; current_version: number;
  processor_code: string; processor_version: string;
  processor_manifest: JsonRecord; config: JsonRecord; trigger: JsonRecord;
  start_at: string; inputs?: Array<JsonRecord>; outputs?: Array<{ code: string; name: string; kind: string; unit?: string; content_type?: string }>; created_at: string; updated_at: string;
  last_execution_status?: string; last_execution_at?: string;
};
export type ProcessingResult = {
  id: string; output_code: string; kind: "metric" | "record" | "artifact";
  observed_at?: string; numeric_value?: number; unit?: string; record: JsonRecord;
  url?: string; content_type?: string; created_at: string;
};
export type ProcessingExecution = {
  id: string; task_id: string; task_version: number; input_key: string; status: string; attempt: number;
  observed_at?: string; queued_at?: string; started_at?: string; finished_at?: string;
  error_message: string; inputs?: Array<{ slot_code: string; kind: string; url?: string; observed_at?: string; metadata?: JsonRecord }>; created_at: string; results: ProcessingResult[];
};
export type CarbonNodeStatus = {
  node_id: number;
  status: "has_data" | "no_data";
  latest_sample_at?: string;
  latest_flux_at?: string;
};
export type CarbonOverview = {
  device_id: string;
  external_device_id: number;
  nodes_count: number;
  nodes: CarbonNodeStatus[];
  status: "has_data" | "no_data";
  runtime?: { battery?: string; signal?: string; network?: string };
  latest_sample_at?: string;
  latest_flux_at?: string;
  refreshed_at: string;
};
export type CarbonFluxPoint = {
  node_id: number;
  period: string;
  period_at: string;
  field: string;
  nee?: number;
  er?: number;
  gpp?: number;
};
export type CarbonFluxResponse = {
  device_id: string;
  node_id: number;
  field: string;
  start: string;
  end: string;
  points: CarbonFluxPoint[];
};
export type CarbonPeriodSummary = {
  node_id: number;
  period: string;
  period_at: string;
  fields: string[];
  flux_fields: string[];
};
export type CarbonSensorSample = {
  ts: string;
  co2?: number;
  temperature?: number;
  humidity?: number;
  temp_l?: number;
  humi_l?: number;
  temp_b?: number;
  humi_b?: number;
  stemp?: number;
  shumi?: number;
};
export type CarbonRawPhase = {
  room: "light" | "black" | string;
  field: string;
  start_at?: string;
  end_at?: string;
  samples: number;
  complete: boolean;
  points: CarbonSensorSample[];
};
export type CarbonPeriodDetail = {
  device_id: string;
  external_device_id: number;
  node_id: number;
  period: string;
  period_at: string;
  field: string;
  flux?: { field: string; nee?: number; er?: number; gpp?: number };
  phases: CarbonRawPhase[];
  warnings?: string[];
};

const queryString = (
  values: Record<string, string | number | boolean | undefined | null>,
) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : "";
};

const jsonRequest = <T>(path: string, method: string, body?: unknown) =>
  request<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const adminReasonRequest = <T>(path: string, method: string, reason: string, body?: unknown) =>
  request<T>(path, {
    method,
    headers: { "X-Admin-Reason": reason },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    requestId?: string,
    details?: unknown,
    code?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export const apiErrorEvent = "thcpn:api-error";

const notifyApiError = (error: unknown) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(apiErrorEvent, { detail: error }));
  }
};

type TokenPair = { accessToken: string; refreshToken: string };

const tokenKey = "thcpn.auth.tokens";
const adminTokenKey = "thcpn.admin.auth.tokens";
export const authClearedEvent = "thcpn:auth-cleared";
export const adminAuthClearedEvent = "thcpn:admin-auth-cleared";
const isAdminContext = () => typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
const baseUrl =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env
    ?.VITE_API_BASE_URL ?? "";

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
    window.dispatchEvent(new Event(authClearedEvent));
  },
};

export const adminAuthStorage = {
  read(): TokenPair | null {
    try {
      const raw = localStorage.getItem(adminTokenKey);
      return raw ? (JSON.parse(raw) as TokenPair) : null;
    } catch {
      return null;
    }
  },
  write(tokens: TokenPair) { localStorage.setItem(adminTokenKey, JSON.stringify(tokens)); },
  clear() { localStorage.removeItem(adminTokenKey); window.dispatchEvent(new Event(adminAuthClearedEvent)); },
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
    const message =
      body?.error?.message ??
      body?.message ??
      body?.error ??
      response.statusText ??
      "请求失败";
    throw new ApiError(
      String(message),
      response.status,
      body?.error?.request_id ?? body?.request_id ?? requestId,
      body,
      body?.error?.code ?? body?.code,
    );
  }
  return { body, requestId };
};

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (
    init.body &&
    !(typeof FormData !== "undefined" && init.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  const adminRequest = isAdminContext();
  const storage = adminRequest ? adminAuthStorage : authStorage;
  const tokens = storage.read();
  if (tokens?.accessToken)
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch (error) {
    notifyApiError(error);
    throw error;
  }
  try {
    const { body } = await parseResponse(response);
    return body as T;
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      retry &&
      tokens?.refreshToken
    ) {
      try {
        const refreshed = await request<{ access_token: string; refresh_token: string }>(
          adminRequest ? "/api/v1/admin/auth/refresh" : "/api/v1/auth/refresh",
          {
            method: "POST",
            body: JSON.stringify({ refresh_token: tokens.refreshToken }),
          },
          false,
        );
        storage.write({
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
        });
        return request<T>(path, init, false);
      } catch {
        storage.clear();
      }
    }
    notifyApiError(error);
    throw error;
  }
}

async function anonymousRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: "same-origin" });
  const { body } = await parseResponse(response);
  return body as T;
}

async function download(path: string): Promise<Blob> {
  const headers = new Headers();
  const storage = isAdminContext() ? adminAuthStorage : authStorage;
  const tokens = storage.read();
  if (tokens?.accessToken)
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { headers });
  } catch (error) {
    notifyApiError(error);
    throw error;
  }
  if (!response.ok) {
    try {
      await parseResponse(response);
    } catch (error) {
      notifyApiError(error);
      throw error;
    }
  }
  return response.blob();
}

export const formatApiError = (error: unknown) => {
  if (error instanceof ApiError) {
    const messages: Record<string, { zh: string; en: string }> = {
      invalid_argument: { zh: "请求参数不正确", en: "Invalid request parameters" },
      unauthorized: { zh: "登录状态已失效", en: "Your session has expired" },
      permission_denied: { zh: "没有执行此操作的权限", en: "You do not have permission for this action" },
      not_found: { zh: "请求的资源不存在", en: "The requested resource was not found" },
      conflict: { zh: "数据已经发生变化，请刷新后重试", en: "The data has changed. Refresh and try again" },
      rate_limited: { zh: "操作过于频繁，请稍后重试", en: "Too many requests. Try again later" },
      data_source: { zh: "数据源暂时不可用", en: "The data source is temporarily unavailable" },
      internal: { zh: "服务暂时不可用", en: "The service is temporarily unavailable" },
    };
    const normalizedCode = error.code?.toLowerCase();
    const localized = normalizedCode ? messages[normalizedCode] : undefined;
    const english = typeof document !== "undefined" && document.documentElement.lang === "en-US";
    return {
      message:
        normalizedCode === "invalid_argument" && error.message
          ? error.message
          : localized
            ? localized[english ? "en" : "zh"]
            : error.message,
      code: error.code,
      requestId: error.requestId,
      status: error.status,
    };
  }
  return {
    message: error instanceof Error ? error.message : "网络连接失败",
    code: undefined,
    requestId: undefined,
    status: 0,
  };
};

export const api = {
  health: () => request<{ status: string }>("/healthz", {}, false),
  ready: () => request<{ status: string }>("/readyz", {}, false),
  metrics: () => request<string>("/metrics", {}, false),
  downloadSignedObject: (params: JsonRecord) =>
    download(
      `/api/v1/objects/download${queryString(params as Record<string, string | number | boolean>)}`,
    ),
  auth: {
    login: (payload: {
      identifier: string;
      password: string;
      mfa_code?: string;
    }) =>
      request<LoginResponse>(
        "/api/v1/auth/password/login",
        { method: "POST", body: JSON.stringify(payload) },
        false,
      ),
    register: (payload: {
      name: string;
      phone?: string;
      email?: string;
      password: string;
    }) =>
      request<LoginResponse>(
        "/api/v1/auth/password/register",
        { method: "POST", body: JSON.stringify(payload) },
        false,
      ),
    smsSend: (payload: { phone: string }) =>
      jsonRequest<SendCodeResponse>("/api/v1/auth/sms/send", "POST", payload),
    smsLogin: (payload: JsonRecord) =>
      jsonRequest<LoginResponse>("/api/v1/auth/sms/login", "POST", payload),
    smsRegister: (payload: JsonRecord) =>
      jsonRequest<LoginResponse>("/api/v1/auth/sms/register", "POST", payload),
    devRegister: (payload: JsonRecord) =>
      jsonRequest<JsonRecord>("/api/v1/auth/register", "POST", payload),
    refresh: (refreshToken: string) =>
      jsonRequest<LoginResponse>("/api/v1/auth/refresh", "POST", {
        refresh_token: refreshToken,
      }),
    completeInitialPassword: (payload: { password_change_token: string; password: string }) =>
      jsonRequest<LoginResponse>("/api/v1/auth/password/complete-initial", "POST", payload),
    changePassword: (payload: { current_password: string; new_password: string }) =>
      jsonRequest<{ signed_out: boolean }>("/api/v1/auth/password/change", "POST", payload),
    sendPasswordResetCode: (phone: string) =>
      jsonRequest<SendCodeResponse>("/api/v1/auth/password/reset/send", "POST", { phone }),
    resetPassword: (payload: { phone: string; code: string; new_password: string }) =>
      jsonRequest<{ reset: boolean }>("/api/v1/auth/password/reset", "POST", payload),
    logout: (refreshToken?: string) =>
      jsonRequest<void>(
        "/api/v1/auth/logout",
        "POST",
        refreshToken ? { refresh_token: refreshToken } : {},
      ),
    sessions: () => request<ListResponse<AuthSession>>("/api/v1/auth/sessions"),
    revokeSession: (id: string) =>
      request<void>(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    sendEmailCode: (email: string) =>
      jsonRequest<SendCodeResponse>("/api/v1/auth/email/send", "POST", {
        email,
      }),
    verifyEmailCode: (email: string, code: string) =>
      jsonRequest<{ user: User }>("/api/v1/auth/email/verify", "POST", {
        email,
        code,
      }),
    mfaStatus: () => request<MfaStatus>("/api/v1/auth/mfa"),
    mfaSetup: () =>
      jsonRequest<TotpSetup>("/api/v1/auth/mfa/totp/setup", "POST", {}),
    mfaEnable: (code: string) =>
      jsonRequest<MfaStatus>("/api/v1/auth/mfa/totp/enable", "POST", { code }),
    mfaDisable: (code: string) =>
      jsonRequest<void>("/api/v1/auth/mfa/totp", "DELETE", { code }),
  },
  adminAuth: {
    login: (payload: { email: string; password: string }) =>
      request<AdminLoginResponse>("/api/v1/admin/auth/password/login", { method: "POST", body: JSON.stringify(payload) }, false),
    refresh: (refreshToken: string) =>
      request<AdminLoginResponse>("/api/v1/admin/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }, false),
    logout: (refreshToken?: string) =>
      request<void>("/api/v1/admin/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken ?? "" }) }, false),
    changePassword: (payload: { current_password: string; new_password: string }) =>
      jsonRequest<{ signed_out: boolean }>("/api/v1/admin/auth/password/change", "POST", payload),
    me: () => request<{ admin: AdminUser }>("/api/v1/admin/me"),
  },
  me: Object.assign(
    () => request<{ user: User }>("/api/v1/me"),
    {
      get: () => request<{ user: User }>("/api/v1/me"),
      update: (payload: { name: string }) => jsonRequest<{ user: User }>("/api/v1/me", "PATCH", payload),
    },
  ),
  workspaces: {
    list: () =>
      request<ListResponse<WorkspaceWithMembership>>("/api/v1/workspaces"),
    create: (payload: { name: string; organization_type: string }) =>
      request<WorkspaceWithMembership>("/api/v1/workspaces", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    update: (workspaceId: string, payload: { name: string }) =>
      jsonRequest<WorkspaceWithMembership>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, "PATCH", payload),
    billing: (workspaceId: string) => request<WorkspaceBillingSummary>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/billing`),
    apiKeys: (workspaceId: string) => request<ListResponse<WorkspaceApiKey>>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/api-keys`),
    createApiKey: (workspaceId: string, payload: JsonRecord) => jsonRequest<WorkspaceApiKeyCreated>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/api-keys`, "POST", payload),
    revokeApiKey: (workspaceId: string, keyId: string) => request<void>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" }),
    adminList: (filters: JsonRecord = {}) =>
      request<ListResponse<JsonRecord>>(`/api/v1/admin/workspaces${queryString(filters as Record<string, string | number | boolean>)}`),
  },
  notifications: {
    list: (workspaceId?: string, limit = 50) => request<JsonRecord>(`/api/v1/notifications${queryString({ workspace_id: workspaceId, limit })}`),
    read: (id: string) => jsonRequest<void>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, "POST", {}),
    readAll: (workspaceId?: string) => jsonRequest<void>(`/api/v1/notifications/read-all${queryString({ workspace_id: workspaceId })}`, "POST", {}),
    announcements: (workspaceId?: string) => request<JsonRecord>(`/api/v1/announcements${queryString({ workspace_id: workspaceId })}`),
    readAnnouncement: (id: string) => jsonRequest<void>(`/api/v1/announcements/${encodeURIComponent(id)}/read`, "POST", {}),
  },
  projects: {
    list: (workspaceId: string) =>
      request<ListResponse<JsonRecord>>(
        `/api/v1/projects${queryString({ workspace_id: workspaceId })}`,
      ),
    adminList: (workspaceId?: string) =>
      request<ListResponse<JsonRecord>>(
        `/api/v1/admin/projects${queryString({ workspace_id: workspaceId })}`,
      ),
    get: (id: string) =>
      request<JsonRecord>(`/api/v1/projects/${encodeURIComponent(id)}`),
    create: (payload: JsonRecord) =>
      jsonRequest<JsonRecord>(isAdminContext() ? "/api/v1/admin/projects" : "/api/v1/projects", "POST", payload),
    update: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `${isAdminContext() ? "/api/v1/admin/projects" : "/api/v1/projects"}/${encodeURIComponent(id)}`,
        "PATCH",
        payload,
      ),
  },
  sites: {
    list: (workspaceId: string, projectId?: string) =>
      request<ListResponse<JsonRecord>>(
        `/api/v1/sites${queryString({ workspace_id: workspaceId, project_id: projectId })}`,
      ),
    adminList: (workspaceId?: string, projectId?: string) =>
      request<ListResponse<JsonRecord>>(
        `/api/v1/admin/sites${queryString({ workspace_id: workspaceId, project_id: projectId })}`,
      ),
    get: (id: string) =>
      request<JsonRecord>(`/api/v1/sites/${encodeURIComponent(id)}`),
    create: (payload: JsonRecord) =>
      jsonRequest<JsonRecord>(isAdminContext() ? "/api/v1/admin/sites" : "/api/v1/sites", "POST", payload),
    update: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `${isAdminContext() ? "/api/v1/admin/sites" : "/api/v1/sites"}/${encodeURIComponent(id)}`,
        "PATCH",
        payload,
      ),
    environment: (id: string) => request<SiteEnvironment>(`${isAdminContext() ? "/api/v1/admin/sites" : "/api/v1/sites"}/${encodeURIComponent(id)}/environment`),
    updateEnvironment: (id: string, payload: JsonRecord) => jsonRequest<SiteEnvironment>(`${isAdminContext() ? "/api/v1/admin/sites" : "/api/v1/sites"}/${encodeURIComponent(id)}/environment`, "PATCH", payload),
  },
  members: {
    list: (workspaceId: string) =>
      request<ListResponse<JsonRecord>>(
        `${isAdminContext() ? "/api/v1/admin/workspaces" : "/api/v1/workspaces"}/${encodeURIComponent(workspaceId)}/members`,
      ),
    add: (workspaceId: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `${isAdminContext() ? "/api/v1/admin/workspaces" : "/api/v1/workspaces"}/${encodeURIComponent(workspaceId)}/members`,
        "POST",
        payload,
      ),
    update: (workspaceId: string, memberId: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `${isAdminContext() ? "/api/v1/admin/workspaces" : "/api/v1/workspaces"}/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
        "PATCH",
        payload,
      ),
    remove: (workspaceId: string, memberId: string) =>
      request<void>(
        `${isAdminContext() ? "/api/v1/admin/workspaces" : "/api/v1/workspaces"}/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
        { method: "DELETE" },
      ),
  },
  permissions: {
    catalog: () => request<JsonRecord>("/api/v1/permissions/catalog"),
  },
  devices: {
    list: (
      workspaceId: string,
      filters: { projectId?: string; siteId?: string } = {},
    ) => {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (filters.projectId) params.set("project_id", filters.projectId);
      if (filters.siteId) params.set("site_id", filters.siteId);
      return request<ListResponse<Device>>(`/api/v1/devices?${params}`);
    },
    get: (id: string) =>
      request<Device>(`/api/v1/devices/${encodeURIComponent(id)}`),
    latestAttributes: (id: string) =>
      request<THCPNLatestAttributesResponse>(
        `/api/v1/devices/${encodeURIComponent(id)}/attributes/latest`,
      ),
    runtime: async (deviceIds: string[]) => {
      const batches = Array.from(
        { length: Math.ceil(deviceIds.length / 200) },
        (_, index) => deviceIds.slice(index * 200, (index + 1) * 200),
      );
      const responses = await Promise.all(
        batches.map((ids) =>
          request<THCPNDeviceRuntimeBatchResponse>(
            `/api/v1/devices/runtime?${new URLSearchParams({ device_ids: ids.join(",") })}`,
          ),
        ),
      );
      return {
        items: responses.flatMap((item) => item.items),
        failures: responses.flatMap((item) => item.failures),
        refreshed_at: responses.at(-1)?.refreshed_at ?? new Date().toISOString(),
      } satisfies THCPNDeviceRuntimeBatchResponse;
    },
    update: (id: string, payload: JsonRecord) =>
      jsonRequest<Device>(
        `/api/v1/devices/${encodeURIComponent(id)}`,
        "PATCH",
        payload,
      ),
    profile: (id: string) =>
      request<DeviceProfile>(
        `/api/v1/devices/${encodeURIComponent(id)}/profile`,
      ),
    updateProfile: (id: string, payload: JsonRecord) =>
      jsonRequest<DeviceProfile>(
        `/api/v1/devices/${encodeURIComponent(id)}/profile`,
        "PATCH",
        payload,
      ),
    environment: (id: string) => request<DeviceEnvironment>(`/api/v1/devices/${encodeURIComponent(id)}/environment`),
    updateEnvironment: (id: string, payload: JsonRecord) => jsonRequest<DeviceEnvironment>(`/api/v1/devices/${encodeURIComponent(id)}/environment`, "PATCH", payload),
    taxonomy: () => request<ListResponse<DeviceTaxonomyTerm>>("/api/v1/device-taxonomy/catalog"),
    map: (workspaceId: string, includeChildren = false) => request<DeviceMapResult>(`/api/v1/device-map?workspace_id=${encodeURIComponent(workspaceId)}&include_children=${includeChildren}`),
    samplingProfile: (id: string) =>
      request<SamplingProfile>(
        `/api/v1/devices/${encodeURIComponent(id)}/sampling-profile`,
      ),
    updateSamplingProfile: (id: string, payload: UpdateSamplingProfile) =>
      jsonRequest<SamplingProfile>(
        `/api/v1/devices/${encodeURIComponent(id)}/sampling-profile`,
        "PATCH",
        payload,
      ),
    publicAccess: (id: string) =>
      request<DevicePublicAccess>(
        `/api/v1/devices/${encodeURIComponent(id)}/public-access`,
      ),
    updatePublicAccess: (id: string, payload: { enabled: boolean; password_enabled: boolean; password?: string }) =>
      jsonRequest<DevicePublicAccess>(
        `/api/v1/devices/${encodeURIComponent(id)}/public-access`,
        "PATCH",
        payload,
      ),
    metadata: (id: string) =>
      request<ListResponse<DeviceMetadata>>(
        `/api/v1/devices/${encodeURIComponent(id)}/metadata`,
      ),
    replaceMetadata: (id: string, items: DeviceMetadataInput[]) =>
      jsonRequest<ListResponse<DeviceMetadata>>(
        `/api/v1/devices/${encodeURIComponent(id)}/metadata`,
        "PUT",
        { items },
      ),
    computedStreams: (id: string) =>
      request<ListResponse<ComputedDataStream>>(
        `/api/v1/devices/${encodeURIComponent(id)}/computed-streams`,
      ),
    createComputedStream: (
      id: string,
      payload: { code: string; name: string; unit?: string; formula: string; enabled?: boolean },
    ) =>
      jsonRequest<ComputedDataStream>(
        `/api/v1/devices/${encodeURIComponent(id)}/computed-streams`,
        "POST",
        payload,
      ),
    updateComputedStream: (
      id: string,
      streamId: string,
      payload: Partial<{ code: string; name: string; unit: string; formula: string; enabled: boolean }>,
    ) =>
      jsonRequest<ComputedDataStream>(
        `/api/v1/devices/${encodeURIComponent(id)}/computed-streams/${encodeURIComponent(streamId)}`,
        "PATCH",
        payload,
      ),
    deleteComputedStream: (id: string, streamId: string) =>
      request<void>(
        `/api/v1/devices/${encodeURIComponent(id)}/computed-streams/${encodeURIComponent(streamId)}`,
        { method: "DELETE" },
      ),
    previewComputedStream: (
      id: string,
      payload: { formula: string; streams: Record<string, number>; metadata?: Record<string, number> },
    ) =>
      jsonRequest<{
        value: number;
        referenced_stream_codes: string[];
        referenced_metadata_keys: string[];
      }>(
        `/api/v1/devices/${encodeURIComponent(id)}/computed-streams/preview`,
        "POST",
        payload,
      ),
    uploadProfileImages: (id: string, files: File[]) => {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      return request<ListResponse<DeviceProfileImage>>(
        `/api/v1/devices/${encodeURIComponent(id)}/profile/images`,
        { method: "POST", body },
      );
    },
    updateProfileImage: (id: string, imageId: string, payload: JsonRecord) =>
      jsonRequest<DeviceProfileImage>(
        `/api/v1/devices/${encodeURIComponent(id)}/profile/images/${encodeURIComponent(imageId)}`,
        "PATCH",
        payload,
      ),
    reorderProfileImages: (id: string, imageIds: string[]) =>
      jsonRequest<ListResponse<DeviceProfileImage>>(
        `/api/v1/devices/${encodeURIComponent(id)}/profile/images/order`,
        "PUT",
        { image_ids: imageIds },
      ),
    deleteProfileImage: (id: string, imageId: string) =>
      request<void>(
        `/api/v1/devices/${encodeURIComponent(id)}/profile/images/${encodeURIComponent(imageId)}`,
        { method: "DELETE" },
      ),
    children: (id: string) =>
      request<ListResponse<DeviceChild>>(
        `/api/v1/devices/${encodeURIComponent(id)}/children`,
      ),
    liveSession: (id: string) =>
      jsonRequest<CameraLiveSession>(
        `/api/v1/devices/${encodeURIComponent(id)}/camera/live-session`,
        "POST",
        {},
      ),
    calibrate: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/devices/${encodeURIComponent(id)}/calibrations`,
        "POST",
        payload,
      ),
    firmwareUpgrade: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/devices/${encodeURIComponent(id)}/firmware-upgrades`,
        "POST",
        payload,
      ),
    transfer: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/devices/${encodeURIComponent(id)}/transfer`,
        "POST",
        payload,
      ),
    unbind: (id: string) =>
      request<void>(`/api/v1/devices/${encodeURIComponent(id)}/unbind`, {
        method: "POST",
      }),
  },
  carbon: {
    overview: (deviceId: string) =>
      request<CarbonOverview>(`/api/v1/devices/${encodeURIComponent(deviceId)}/carbon/overview`),
    flux: (
      deviceId: string,
      input: { nodeId: number; field: string; start?: string; end?: string },
    ) =>
      request<CarbonFluxResponse>(
        `/api/v1/devices/${encodeURIComponent(deviceId)}/carbon/flux${queryString({ node_id: input.nodeId, field: input.field, start: input.start, end: input.end })}`,
      ),
    periods: (
      deviceId: string,
      input: { nodeId: number; start?: string; end?: string },
    ) =>
      request<ListResponse<CarbonPeriodSummary>>(
        `/api/v1/devices/${encodeURIComponent(deviceId)}/carbon/periods${queryString({ node_id: input.nodeId, start: input.start, end: input.end })}`,
      ),
    period: (deviceId: string, input: { nodeId: number; field: string; period: string }) =>
      request<CarbonPeriodDetail>(
        `/api/v1/devices/${encodeURIComponent(deviceId)}/carbon/periods/${encodeURIComponent(input.period)}${queryString({ node_id: input.nodeId, field: input.field })}`,
      ),
    export: (deviceId: string, payload: { export_type: "carbon_flux_csv" | "carbon_raw_csv"; node_id: number; field: string; start_time: string; end_time: string; limit?: number }) =>
      jsonRequest<ExportJob>(
        `/api/v1/devices/${encodeURIComponent(deviceId)}/carbon/exports`,
        "POST",
        payload,
      ),
  },
  deviceClaims: {
    entry: (slug: string) =>
      anonymousRequest<{ login_required: boolean }>(
        `/api/v1/device-claims/${encodeURIComponent(slug)}`,
      ),
    resolve: (payload: { claim_slug?: string; serial_no?: string; code?: string }) =>
      jsonRequest<DeviceClaimCredential>("/api/v1/device-claims/resolve", "POST", payload),
    claim: (
      payload: {
        claim_slug?: string;
        serial_no?: string;
        code?: string;
        workspace_id: string;
        project_id?: string;
        site_id?: string;
      },
      idempotencyKey: string,
    ) =>
      request<DeviceClaimResult>("/api/v1/device-claims/claim", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      }),
  },
  publicDevices: {
    get: (slug: string) =>
      anonymousRequest<PublicDevice>(`/api/v1/public/devices/${encodeURIComponent(slug)}`),
    unlock: (slug: string, password: string) =>
      anonymousRequest<void>(`/api/v1/public/devices/${encodeURIComponent(slug)}/unlock`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    telemetry: (slug: string) =>
      anonymousRequest<TelemetryQueryResponse>(`/api/v1/public/devices/${encodeURIComponent(slug)}/telemetry`),
    images: (slug: string, streamId: string, page = 1, pageSize = 24) =>
      anonymousRequest<MediaListResponse>(
        `/api/v1/public/devices/${encodeURIComponent(slug)}/images${queryString({ data_stream_id: streamId, page, page_size: pageSize })}`,
      ),
  },
  dataStreams: {
    list: (deviceId: string) =>
      request<ListResponse<DataStream>>(
        `/api/v1/data-streams?device_id=${encodeURIComponent(deviceId)}`,
      ),
    get: (id: string) =>
      request<DataStream>(`/api/v1/data-streams/${encodeURIComponent(id)}`),
  },
  telemetry: {
    device: (
      deviceId: string,
      input: { startTime: string; endTime: string; limit?: number; adaptive?: boolean; targetPoints?: number; dataStreamIds?: string[] },
    ) => {
      const params = new URLSearchParams({
        start_time: input.startTime,
        end_time: input.endTime,
      });
      if (input.limit) params.set("limit", String(input.limit));
      if (input.adaptive !== undefined) params.set("adaptive", String(input.adaptive));
      if (input.targetPoints) params.set("target_points", String(input.targetPoints));
      if (input.dataStreamIds?.length) {
        params.set("data_stream_ids", [...input.dataStreamIds].sort().join(","));
      }
      return request<TelemetryQueryResponse>(
        `/api/v1/devices/${encodeURIComponent(deviceId)}/telemetry?${params}`,
      );
    },
    dataStream: (
      id: string,
      input: { startTime: string; endTime: string; limit?: number; adaptive?: boolean; targetPoints?: number },
    ) =>
      request<TelemetryQueryResponse>(
        `/api/v1/data-streams/${encodeURIComponent(id)}/telemetry${queryString({ start_time: input.startTime, end_time: input.endTime, limit: input.limit, adaptive: input.adaptive, target_points: input.targetPoints })}`,
      ),
    dataset: (
      id: string,
      input: { startTime?: string; endTime?: string; limit?: number } = {},
    ) =>
      request<JsonRecord>(
        `/api/v1/datasets/${encodeURIComponent(id)}/telemetry${queryString({ start_time: input.startTime, end_time: input.endTime, limit: input.limit })}`,
      ),
  },
  media: {
    device: (id: string, input: JsonRecord) =>
      request<MediaListResponse>(
        `/api/v1/devices/${encodeURIComponent(id)}/media${queryString(input as Record<string, string | number | boolean>)}`,
      ),
    images: (id: string, input: JsonRecord) =>
      request<MediaListResponse>(
        `/api/v1/devices/${encodeURIComponent(id)}/media/images${queryString(input as Record<string, string | number | boolean>)}`,
      ),
    videos: (id: string, input: JsonRecord) =>
      request<MediaListResponse>(
        `/api/v1/devices/${encodeURIComponent(id)}/media/videos${queryString(input as Record<string, string | number | boolean>)}`,
      ),
    dataStream: (id: string, input: JsonRecord) =>
      request<MediaListResponse>(
        `/api/v1/data-streams/${encodeURIComponent(id)}/media${queryString(input as Record<string, string | number | boolean>)}`,
      ),
    prepareDownload: (payload: JsonRecord) =>
      request<JsonRecord>(
        `/api/v1/media/download${queryString({ token: String(payload.token ?? "") })}`,
      ),
    remove: (payload: JsonRecord) =>
      request<JsonRecord>(
        `/api/v1/media${queryString({ token: String(payload.token ?? "") })}`,
        { method: "DELETE" },
      ),
  },
  datasets: {
    list: (workspaceId: string, projectId?: string) =>
      request<ListResponse<Dataset>>(
        `/api/v1/datasets${queryString({ workspace_id: workspaceId, project_id: projectId })}`,
      ),
    get: (id: string) =>
      request<Dataset>(`/api/v1/datasets/${encodeURIComponent(id)}`),
    create: (payload: JsonRecord) =>
      jsonRequest<Dataset>("/api/v1/datasets", "POST", payload),
    update: (id: string, payload: JsonRecord) =>
      jsonRequest<Dataset>(
        `/api/v1/datasets/${encodeURIComponent(id)}`,
        "PATCH",
        payload,
      ),
    remove: (id: string) =>
      request<void>(`/api/v1/datasets/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    export: (id: string, payload: JsonRecord = {}) =>
      jsonRequest<ExportJob>(
        `/api/v1/datasets/${encodeURIComponent(id)}/export`,
        "POST",
        payload,
      ),
  },
  exports: {
    list: (workspaceId?: string, mine = true, limit = 100) =>
      request<ListResponse<ExportJob>>(
        `/api/v1/export-jobs${queryString({ workspace_id: workspaceId, mine, limit })}`,
      ),
    get: (id: string) =>
      request<ExportJob>(`/api/v1/export-jobs/${encodeURIComponent(id)}`),
    create: (payload: JsonRecord) =>
      jsonRequest<ExportJob>("/api/v1/export-jobs", "POST", payload),
    download: (id: string) =>
      request<JsonRecord>(
        `/api/v1/export-jobs/${encodeURIComponent(id)}/download`,
      ),
  },
  processing: {
    processors: () => request<ListResponse<ProcessingProcessor>>("/api/v1/processing/processors"),
    list: (workspaceId: string) => request<ListResponse<ProcessingTask>>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/processing-tasks`),
    get: (workspaceId: string, taskId: string) => request<ProcessingTask>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/processing-tasks/${encodeURIComponent(taskId)}`),
    executions: (workspaceId: string, taskId: string) => request<ListResponse<ProcessingExecution>>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/processing-tasks/${encodeURIComponent(taskId)}/executions`),
    create: (workspaceId: string, payload: JsonRecord) => jsonRequest<ProcessingTask>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/processing-tasks`, "POST", payload),
    status: (workspaceId: string, taskId: string, status: string) => jsonRequest<ProcessingTask>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/processing-tasks/${encodeURIComponent(taskId)}/status`, "PATCH", { status }),
  },
  accessGrants: {
    list: (
      workspaceId?: string,
      scope?: { type: string; id: string },
    ) =>
      request<ListResponse<JsonRecord>>(
        `${isAdminContext() ? "/api/v1/admin/access-grants" : "/api/v1/access-grants"}${queryString({ workspace_id: workspaceId, scope_type: scope?.type, scope_id: scope?.id })}`,
      ),
    mine: () => request<ListResponse<JsonRecord>>("/api/v1/access-grants/mine"),
    create: (payload: JsonRecord) =>
      jsonRequest<JsonRecord>(isAdminContext() ? "/api/v1/admin/access-grants" : "/api/v1/access-grants", "POST", payload),
    revoke: (id: string) =>
      request<void>(`${isAdminContext() ? "/api/v1/admin/access-grants" : "/api/v1/access-grants"}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
  },
  invitations: {
    list: (
      workspaceId?: string,
      scope?: { type: string; id: string },
    ) =>
      request<ListResponse<JsonRecord>>(
        `${isAdminContext() ? "/api/v1/admin/invitations" : "/api/v1/invitations"}${queryString({ workspace_id: workspaceId, scope_type: scope?.type, scope_id: scope?.id })}`,
      ),
    mine: () => request<ListResponse<JsonRecord>>("/api/v1/invitations/mine"),
    create: (payload: JsonRecord) =>
      jsonRequest<JsonRecord>(isAdminContext() ? "/api/v1/admin/invitations" : "/api/v1/invitations", "POST", payload),
    accept: (id: string) =>
      jsonRequest<JsonRecord>(
        `/api/v1/invitations/${encodeURIComponent(id)}/accept`,
        "POST",
        {},
      ),
    revoke: (id: string) =>
      request<void>(`${isAdminContext() ? "/api/v1/admin/invitations" : "/api/v1/invitations"}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
  },
  audit: {
    list: (workspaceId: string, limit = 100) =>
      request<ListResponse<JsonRecord>>(
        `${isAdminContext() ? "/api/v1/admin/audit-logs" : "/api/v1/audit-logs"}${queryString({ workspace_id: workspaceId, limit })}`,
      ),
  },
    admin: {
    workspaces: {
      list: (filters: JsonRecord = {}) => request<ListResponse<JsonRecord>>(`/api/v1/admin/workspaces${queryString(filters as Record<string, string | number | boolean>)}`),
      get: (id: string) => request<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(id)}`),
      updateStatus: (id: string, reason: string, payload: JsonRecord) => adminReasonRequest<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(id)}/status`, "PATCH", reason, payload),
      transferOwner: (id: string, reason: string, payload: JsonRecord) => adminReasonRequest<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(id)}/transfer-owner`, "POST", reason, payload),
      billing: (id: string) => request<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(id)}/billing`),
      billingHistory: (id: string) => request<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(id)}/billing/history`),
      grantProfessional: (id: string, reason: string, payload: JsonRecord) => adminReasonRequest<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(id)}/billing/grants`, "POST", reason, payload),
      addTrafficPack: (id: string, reason: string, payload: JsonRecord) => adminReasonRequest<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(id)}/billing/traffic-packs`, "POST", reason, payload),
      billingRisks: (risk?: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/billing/workspaces${queryString({ risk })}`),
    },
    permissionsCatalog: () => request<JsonRecord>("/api/v1/admin/permissions/catalog"),
    announcements: {
      list: () => request<JsonRecord>("/api/v1/admin/announcements"),
      create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/announcements", "POST", payload),
      setStatus: (id: string, status: string) => jsonRequest<void>(`/api/v1/admin/announcements/${encodeURIComponent(id)}/status`, "PATCH", { status }),
      sendNotification: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/notifications", "POST", payload),
    },
    sources: () =>
      request<ListResponse<Record<string, unknown>>>(
        "/api/v1/admin/data-sources",
      ),
    createSource: (payload: JsonRecord) =>
      jsonRequest<JsonRecord>("/api/v1/admin/data-sources", "POST", payload),
    updateSource: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/data-sources/${encodeURIComponent(id)}`,
        "PATCH",
        payload,
      ),
    syncStation: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/data-sources/${encodeURIComponent(id)}/thcpn-standard-station/devices`,
        "POST",
        payload,
      ),
    syncAllDevices: (id: string) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/data-sources/${encodeURIComponent(id)}/thcpn-standard-station/devices/sync-all`,
        "POST",
        {},
      ),
    carbonDevices: (id: string) =>
      request<ListResponse<Record<string, unknown>>>(
        `/api/v1/admin/data-sources/${encodeURIComponent(id)}/carbon-sink/devices`,
      ),
    syncCarbonDevice: (id: string, payload: { external_device_id: number }) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/data-sources/${encodeURIComponent(id)}/carbon-sink/devices`,
        "POST",
        payload,
      ),
    syncAllCarbonDevices: (id: string) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/data-sources/${encodeURIComponent(id)}/carbon-sink/devices/sync-all`,
        "POST",
        {},
      ),
    syncGateway: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/data-sources/${encodeURIComponent(id)}/thcpn-standard-station/gateways`,
        "POST",
        payload,
      ),
    syncCamera: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/data-sources/${encodeURIComponent(id)}/thcpn-standard-station/cameras`,
        "POST",
        payload,
      ),
    devices: () =>
      request<ListResponse<Record<string, unknown>>>("/api/v1/admin/devices"),
    ensureDeviceClaimCredentials: () =>
      jsonRequest<{ created: number }>("/api/v1/admin/device-claims/ensure", "POST", {}),
    deviceClaimCredential: (id: string) =>
      request<DeviceClaimCredential>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/claim-credential`,
      ),
    markDeviceClaimCredentialPrinted: (id: string) =>
      jsonRequest<void>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/claim-credential/printed`,
        "POST",
        {},
      ),
    deviceAttributes: (id: string) =>
      request<THCPNLatestAttributesResponse>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/attributes/latest`,
      ),
    carbonOverview: (id: string) =>
      request<CarbonOverview>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/carbon/overview`,
      ),
    deviceRuntime: async (deviceIds: string[]) => {
      const batches = Array.from(
        { length: Math.ceil(deviceIds.length / 200) },
        (_, index) => deviceIds.slice(index * 200, (index + 1) * 200),
      );
      const responses = await Promise.all(
        batches.map((ids) =>
          request<THCPNDeviceRuntimeBatchResponse>(
            `/api/v1/admin/devices/runtime?${new URLSearchParams({ device_ids: ids.join(",") })}`,
          ),
        ),
      );
      return {
        items: responses.flatMap((item) => item.items),
        failures: responses.flatMap((item) => item.failures),
        refreshed_at: responses.at(-1)?.refreshed_at ?? new Date().toISOString(),
      } satisfies THCPNDeviceRuntimeBatchResponse;
    },
    deviceLogs: (id: string, input: JsonRecord = {}) =>
      request<THCPNDeviceLogListResponse>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/logs${queryString(input as Record<string, string | number | boolean>)}`,
      ),
    deviceLogPreview: (id: string, logUUID: string) =>
      request<THCPNDeviceLogAccessResponse>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/logs/${encodeURIComponent(logUUID)}/preview`,
      ),
    deviceLogDownload: (id: string, logUUID: string) =>
      download(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/logs/${encodeURIComponent(logUUID)}/download`,
      ),
    platformLogs: (input: JsonRecord = {}) =>
      request<ListResponse<JsonRecord>>(
        `/api/v1/admin/platform-logs${queryString(input as Record<string, string | number | boolean>)}`,
      ),
    platformLog: (id: string | number) =>
      request<JsonRecord>(`/api/v1/admin/platform-logs/${encodeURIComponent(String(id))}`),
    platformLogPolicy: () => request<JsonRecord>("/api/v1/admin/platform-logs/policy"),
    rebuildPlatformLogIndex: () =>
      jsonRequest<JsonRecord>("/api/v1/admin/platform-logs/index/rebuild", "POST", {}),
    exportPlatformLogs: (input: JsonRecord = {}) =>
      download(`/api/v1/admin/platform-logs/export${queryString(input as Record<string, string | number | boolean>)}`),
    platformLogFiles: () => request<ListResponse<JsonRecord>>("/api/v1/admin/platform-logs/files"),
    downloadPlatformLogFile: (name: string) => download(`/api/v1/admin/platform-logs/files/${encodeURIComponent(name)}/download`),
    updateDevice: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}`,
        "PATCH",
        payload,
      ),
    deviceChildren: (id: string) =>
      request<ListResponse<JsonRecord>>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/children`,
      ),
    addDeviceChild: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/children`,
        "POST",
        payload,
      ),
    removeDeviceChild: (id: string, childId: string) =>
      request<void>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/children/${encodeURIComponent(childId)}`,
        { method: "DELETE" },
      ),
    deviceConfig: (id: string) =>
      request<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/thcpn-config`,
      ),
    deviceEnvironment: (id: string) => request<DeviceEnvironment>(`/api/v1/admin/devices/${encodeURIComponent(id)}/environment`),
    siteEnvironment: (id: string) => request<SiteEnvironment>(`/api/v1/admin/sites/${encodeURIComponent(id)}/environment`),
    updateSiteEnvironment: (id: string, payload: JsonRecord) => jsonRequest<SiteEnvironment>(`/api/v1/admin/sites/${encodeURIComponent(id)}/environment`, "PATCH", payload),
    updateDeviceEnvironment: (id: string, payload: JsonRecord) => jsonRequest<DeviceEnvironment>(`/api/v1/admin/devices/${encodeURIComponent(id)}/environment`, "PATCH", payload),
    bulkUpdateDeviceEnvironment: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/devices/environment/bulk", "POST", payload),
    deviceTaxonomy: () => request<ListResponse<DeviceTaxonomyTerm>>("/api/v1/admin/metadata/device-taxonomy"),
    upsertDeviceTaxonomy: (payload: JsonRecord) => jsonRequest<DeviceTaxonomyTerm>("/api/v1/admin/metadata/device-taxonomy", "POST", payload),
    deleteDeviceTaxonomy: (id: string) => request<void>(`/api/v1/admin/metadata/device-taxonomy/${encodeURIComponent(id)}`, { method: "DELETE" }),
    deviceMap: (includeChildren = false) => request<DeviceMapResult>(`/api/v1/admin/device-map?include_children=${includeChildren}`),
    sensorTemplates: (id: string, input: JsonRecord = {}) =>
      request<THCPNSensorTemplateListResponse>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/sensor-templates${queryString(input as Record<string, string | number | boolean>)}`,
      ),
    platformSensorTemplates: (input: JsonRecord = {}) =>
      request<THCPNSensorTemplateListResponse>(
        `/api/v1/admin/sensor-templates${queryString(input as Record<string, string | number | boolean>)}`,
      ),
    createSensorTemplate: (payload: SensorTemplateRequest) =>
      jsonRequest<THCPNSensorTemplate>(
        "/api/v1/admin/sensor-templates",
        "POST",
        payload,
      ),
    importSensorTemplates: (dataSourceId: string) =>
      jsonRequest<{ imported: number; skipped: number; invalid: number }>(
        "/api/v1/admin/sensor-templates/import",
        "POST",
        { data_source_id: dataSourceId },
      ),
    updateSensorTemplate: (id: number, payload: SensorTemplateRequest) =>
      jsonRequest<THCPNSensorTemplate>(
        `/api/v1/admin/sensor-templates/${id}`,
        "PUT",
        payload,
      ),
    deleteSensorTemplate: (id: number) =>
      request<void>(`/api/v1/admin/sensor-templates/${id}`, {
        method: "DELETE",
      }),
    updateDeviceConfig: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/thcpn-config`,
        "POST",
        payload,
      ),
    lifecycle: (id: string) =>
      request<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/lifecycle`,
      ),
    updateLifecycle: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/lifecycle`,
        "PATCH",
        payload,
      ),
    capabilities: (id: string) =>
      request<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/capabilities`,
      ),
    updateCapabilities: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/capabilities`,
        "PATCH",
        payload,
      ),
    assignDevice: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/assignment`,
        "POST",
        payload,
      ),
    unassignDevice: (id: string) =>
      request<void>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/assignment`,
        { method: "DELETE" },
      ),
    calibrateDevice: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/calibrations`,
        "POST",
        payload,
      ),
    upgradeDeviceFirmware: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/devices/${encodeURIComponent(id)}/firmware-upgrades`,
        "POST",
        payload,
      ),
    createCamera: (payload: JsonRecord) =>
      jsonRequest<JsonRecord>("/api/v1/admin/cameras", "POST", payload),
    camera: (id: string) =>
      request<JsonRecord>(`/api/v1/admin/cameras/${encodeURIComponent(id)}`),
    updateCamera: (id: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/cameras/${encodeURIComponent(id)}`,
        "PATCH",
        payload,
      ),
    metadata: () =>
      request<ListResponse<Record<string, unknown>>>(
        "/api/v1/admin/metadata/device-capabilities",
      ),
    createCapabilityDefinition: (payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        "/api/v1/admin/metadata/device-capabilities",
        "POST",
        payload,
      ),
    updateCapabilityDefinition: (code: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/metadata/device-capabilities/${encodeURIComponent(code)}`,
        "PATCH",
        payload,
      ),
    roles: () =>
      request<ListResponse<JsonRecord>>("/api/v1/admin/metadata/system-roles"),
    updateRole: (code: string, payload: JsonRecord) =>
      jsonRequest<JsonRecord>(
        `/api/v1/admin/metadata/system-roles/${encodeURIComponent(code)}`,
        "PATCH",
        payload,
      ),
    createProject: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/projects", "POST", payload),
    updateProject: (id: string, reason: string, payload: JsonRecord) => adminReasonRequest<JsonRecord>(`/api/v1/admin/projects/${encodeURIComponent(id)}`, "PATCH", reason, payload),
    createSite: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/sites", "POST", payload),
    updateSite: (id: string, reason: string, payload: JsonRecord) => adminReasonRequest<JsonRecord>(`/api/v1/admin/sites/${encodeURIComponent(id)}`, "PATCH", reason, payload),
    members: {
      list: (workspaceId: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/members`),
      add: (workspaceId: string, reason: string, payload: JsonRecord) => adminReasonRequest<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/members`, "POST", reason, payload),
      update: (workspaceId: string, memberId: string, reason: string, payload: JsonRecord) => adminReasonRequest<JsonRecord>(`/api/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`, "PATCH", reason, payload),
      remove: (workspaceId: string, memberId: string, reason: string) => adminReasonRequest<void>(`/api/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`, "DELETE", reason),
    },
    grants: {
      list: (workspaceId: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/access-grants${queryString({ workspace_id: workspaceId })}`),
      create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/access-grants", "POST", payload),
      revoke: (id: string, reason: string) => adminReasonRequest<void>(`/api/v1/admin/access-grants/${encodeURIComponent(id)}`, "DELETE", reason),
    },
    invitations: {
      list: (workspaceId: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/invitations${queryString({ workspace_id: workspaceId })}`),
      create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/invitations", "POST", payload),
      revoke: (id: string, reason: string) => adminReasonRequest<void>(`/api/v1/admin/invitations/${encodeURIComponent(id)}`, "DELETE", reason),
    },
    audit: (workspaceId: string, filters: JsonRecord = {}) => request<ListResponse<JsonRecord>>(`/api/v1/admin/audit-logs${queryString({ workspace_id: workspaceId, ...(filters as Record<string, string | number | boolean>) })}`),
    users: {
      list: (filters: JsonRecord = {}) => request<ListResponse<JsonRecord>>(`/api/v1/admin/users${queryString(filters as Record<string, string | number | boolean>)}`),
      get: (id: string) => request<JsonRecord>(`/api/v1/admin/users/${encodeURIComponent(id)}`),
      create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/users", "POST", payload),
      update: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/users/${encodeURIComponent(id)}`, "PATCH", payload),
      updateStatus: (id: string, payload: JsonRecord) => jsonRequest<void>(`/api/v1/admin/users/${encodeURIComponent(id)}/status`, "PATCH", payload),
      revokeAllSessions: (id: string, payload: JsonRecord) => jsonRequest<void>(`/api/v1/admin/users/${encodeURIComponent(id)}/sessions/revoke-all`, "POST", payload),
      unlock: (id: string, payload: JsonRecord) => jsonRequest<void>(`/api/v1/admin/users/${encodeURIComponent(id)}/unlock`, "POST", payload),
      resetMFA: (id: string, payload: JsonRecord) => jsonRequest<void>(`/api/v1/admin/users/${encodeURIComponent(id)}/mfa`, "DELETE", payload),
      temporaryPassword: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/users/${encodeURIComponent(id)}/temporary-password`, "POST", payload),
      deletionCheck: (id: string) => request<JsonRecord>(`/api/v1/admin/users/${encodeURIComponent(id)}/deletion-check`),
      workspaces: (id: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/users/${encodeURIComponent(id)}/workspaces`),
      sessions: (id: string) => request<ListResponse<JsonRecord>>(`/api/v1/admin/users/${encodeURIComponent(id)}/sessions`),
      activity: (id: string, filters: JsonRecord = {}) => request<ListResponse<JsonRecord>>(`/api/v1/admin/users/${encodeURIComponent(id)}/activity${queryString(filters as Record<string, string | number | boolean>)}`),
      remove: (id: string, payload: JsonRecord) => jsonRequest<void>(`/api/v1/admin/users/${encodeURIComponent(id)}`, "DELETE", payload),
    },
    administrators: {
      list: () => request<ListResponse<JsonRecord>>("/api/v1/admin/administrators"),
      create: (payload: JsonRecord) => jsonRequest<JsonRecord>("/api/v1/admin/administrators", "POST", payload),
      updateStatus: (id: string, payload: JsonRecord) => jsonRequest<void>(`/api/v1/admin/administrators/${encodeURIComponent(id)}/status`, "PATCH", payload),
      unlock: (id: string, payload: JsonRecord) => jsonRequest<void>(`/api/v1/admin/administrators/${encodeURIComponent(id)}/unlock`, "POST", payload),
      revokeAllSessions: (id: string, payload: JsonRecord) => jsonRequest<void>(`/api/v1/admin/administrators/${encodeURIComponent(id)}/sessions/revoke-all`, "POST", payload),
      temporaryPassword: (id: string, payload: JsonRecord) => jsonRequest<JsonRecord>(`/api/v1/admin/administrators/${encodeURIComponent(id)}/temporary-password`, "POST", payload),
    },
  },
};

export {
  configFieldsFromDetail,
  parseTHCPNConfig,
  validateConfigField,
  type THCPNConfigFields,
} from "./thcpn-config";

export { request };
