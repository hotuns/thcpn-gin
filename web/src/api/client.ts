import type { ErrorEnvelope, StatusResponse } from "./types";
import { authStorage } from "./storage";

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

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

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const requestId = error.requestId ? ` · request ${error.requestId}` : "";
    return `${error.message} (${error.status}${requestId})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败";
}

export function toQueryString(params: QueryParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const { accessToken } = authStorage.read();

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
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
  const data = parseJson(text);

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

function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function get<T>(path: string, params?: QueryParams): Promise<T> {
  return apiFetch<T>(`${path}${toQueryString(params)}`);
}

export function post<T>(path: string, body: unknown = {}): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function del<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "DELETE",
    body: body ? JSON.stringify(body) : undefined
  });
}

export const statusApi = {
  healthz(): Promise<StatusResponse> {
    return get<StatusResponse>("/healthz");
  },

  readyz(): Promise<StatusResponse> {
    return get<StatusResponse>("/readyz");
  }
};
