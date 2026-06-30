import type {
  AuthSessionListResponse,
  DevRegisterResponse,
  ErrorEnvelope,
  InternalMemberRoleCode,
  LoginResponse,
  MFAStatusResponse,
  MeResponse,
  OrganizationType,
  SendCodeResponse,
  SendSmsResponse,
  StatusResponse,
  VerifyEmailResponse,
  WorkspaceListResponse,
  WorkspaceMember,
  WorkspaceMemberListResponse,
  WorkspaceWithMembership,
  TOTPSetupResponse
} from "./types";

const TOKEN_KEY = "thcpn_access_token";
const REFRESH_TOKEN_KEY = "thcpn_refresh_token";

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(status: number, message: string, code?: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function getStoredRefreshToken(): string {
  return localStorage.getItem(REFRESH_TOKEN_KEY) ?? "";
}

export function storeToken(token: string, refreshToken?: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getStoredToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const envelope = data as ErrorEnvelope | null;
    const body = envelope?.error;
    throw new ApiError(
      response.status,
      body?.message || `request failed with status ${response.status}`,
      body?.code,
      body?.request_id
    );
  }

  return data as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export const api = {
  healthz(): Promise<StatusResponse> {
    return apiFetch<StatusResponse>("/healthz");
  },

  readyz(): Promise<StatusResponse> {
    return apiFetch<StatusResponse>("/readyz");
  },

  sendSms(phone: string): Promise<SendSmsResponse> {
    return post<SendSmsResponse>("/api/v1/auth/sms/send", { phone });
  },

  sendEmailVerification(email: string): Promise<SendCodeResponse> {
    return post<SendCodeResponse>("/api/v1/auth/email/send", { email });
  },

  verifyEmail(input: { email: string; code: string }): Promise<VerifyEmailResponse> {
    return post<VerifyEmailResponse>("/api/v1/auth/email/verify", input);
  },

  loginWithSms(input: { phone: string; code: string; mfa_code?: string; name: string }): Promise<LoginResponse> {
    return post<LoginResponse>("/api/v1/auth/sms/login", input);
  },

  registerWithPassword(input: {
    name: string;
    phone: string;
    email: string;
    password: string;
  }): Promise<LoginResponse> {
    return post<LoginResponse>("/api/v1/auth/password/register", input);
  },

  loginWithPassword(input: { identifier: string; password: string; mfa_code?: string }): Promise<LoginResponse> {
    return post<LoginResponse>("/api/v1/auth/password/login", input);
  },

  refreshAuth(refreshToken: string): Promise<LoginResponse> {
    return post<LoginResponse>("/api/v1/auth/refresh", { refresh_token: refreshToken });
  },

  logout(refreshToken?: string): Promise<void> {
    return apiFetch<void>("/api/v1/auth/logout", {
      method: "POST",
      body: refreshToken ? JSON.stringify({ refresh_token: refreshToken }) : undefined
    });
  },

  listAuthSessions(): Promise<AuthSessionListResponse> {
    return apiFetch<AuthSessionListResponse>("/api/v1/auth/sessions");
  },

  revokeAuthSession(sessionId: string): Promise<void> {
    return apiFetch<void>(`/api/v1/auth/sessions/${sessionId}`, {
      method: "DELETE"
    });
  },

  mfaStatus(): Promise<MFAStatusResponse> {
    return apiFetch<MFAStatusResponse>("/api/v1/auth/mfa");
  },

  setupTOTP(): Promise<TOTPSetupResponse> {
    return post<TOTPSetupResponse>("/api/v1/auth/mfa/totp/setup", {});
  },

  enableTOTP(code: string): Promise<MFAStatusResponse> {
    return post<MFAStatusResponse>("/api/v1/auth/mfa/totp/enable", { code });
  },

  disableTOTP(code: string): Promise<void> {
    return apiFetch<void>("/api/v1/auth/mfa/totp", {
      method: "DELETE",
      body: JSON.stringify({ code })
    });
  },

  devRegister(input: { name: string; phone: string; email: string }): Promise<DevRegisterResponse> {
    return post<DevRegisterResponse>("/api/v1/auth/register", input);
  },

  me(): Promise<MeResponse> {
    return apiFetch<MeResponse>("/api/v1/me");
  },

  listWorkspaces(): Promise<WorkspaceListResponse> {
    return apiFetch<WorkspaceListResponse>("/api/v1/workspaces");
  },

  createWorkspace(input: {
    name: string;
    organization_type: OrganizationType;
  }): Promise<WorkspaceWithMembership> {
    return post<WorkspaceWithMembership>("/api/v1/workspaces", input);
  },

  listMembers(workspaceId: string): Promise<WorkspaceMemberListResponse> {
    return apiFetch<WorkspaceMemberListResponse>(`/api/v1/workspaces/${workspaceId}/members`);
  },

  addMember(
    workspaceId: string,
    input: {
      user_id?: string;
      email?: string;
      phone?: string;
      role_code: InternalMemberRoleCode;
    }
  ): Promise<WorkspaceMember> {
    return post<WorkspaceMember>(`/api/v1/workspaces/${workspaceId}/members`, input);
  },

  updateMemberRole(
    workspaceId: string,
    memberId: string,
    roleCode: InternalMemberRoleCode
  ): Promise<WorkspaceMember> {
    return apiFetch<WorkspaceMember>(`/api/v1/workspaces/${workspaceId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ role_code: roleCode })
    });
  },

  removeMember(workspaceId: string, memberId: string): Promise<void> {
    return apiFetch<void>(`/api/v1/workspaces/${workspaceId}/members/${memberId}`, {
      method: "DELETE"
    });
  }
};
