// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, authStorage, formatApiError } from "./index";

const response = (status: number, body: unknown, headers?: Record<string, string>) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("API authentication and errors", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes once after a 401 and retries with the new token", async () => {
    authStorage.write({ accessToken: "old-access", refreshToken: "old-refresh" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401, { error: { message: "expired" } }))
      .mockResolvedValueOnce(response(200, { access_token: "new-access", refresh_token: "new-refresh", user: { id: "u1" } }))
      .mockResolvedValueOnce(response(200, { user: { id: "u1", name: "User" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.me()).resolves.toMatchObject({ user: { id: "u1" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2][1].headers as Headers).get("Authorization")).toBe("Bearer new-access");
    expect(authStorage.read()).toEqual({ accessToken: "new-access", refreshToken: "new-refresh" });
  });

  it("clears the session when refresh fails and does not loop", async () => {
    authStorage.write({ accessToken: "old-access", refreshToken: "old-refresh" });
    const fetchMock = vi.fn().mockResolvedValue(response(401, { error: { message: "unauthorized" } }));
    vi.stubGlobal("fetch", fetchMock);

    const cleared = vi.fn(); window.addEventListener("thcpn:auth-cleared", cleared, { once: true });
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authStorage.read()).toBeNull();
    expect(cleared).toHaveBeenCalledOnce();
  });

  it("preserves backend messages and request IDs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(503, { error: { message: "service unavailable" }, request_id: "req-123" })));
    try { await api.ready(); throw new Error("expected request to fail"); }
    catch (error) { expect(formatApiError(error)).toEqual({ message: "service unavailable", requestId: "req-123", status: 503 }); }
  });

  it("uses the documented POST method when unbinding a device", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(204, undefined));
    vi.stubGlobal("fetch", fetchMock);
    await api.devices.unbind("device-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/devices/device-1/unbind");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("sends the required email and refresh token fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { sent: true, expires_in: 300, cooldown_seconds: 60 }))
      .mockResolvedValueOnce(response(200, { user: { id: "u1" } }))
      .mockResolvedValueOnce(response(204, undefined));
    vi.stubGlobal("fetch", fetchMock);
    await api.auth.sendEmailCode("user@example.com");
    await api.auth.verifyEmailCode("user@example.com", "123456");
    await api.auth.logout("refresh-token");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "user@example.com" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ email: "user@example.com", code: "123456" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ refresh_token: "refresh-token" });
  });

  it("filters sharing queries to a device scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.accessGrants.list("workspace-1", { type: "device", id: "device-1" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/access-grants?workspace_id=workspace-1&scope_type=device&scope_id=device-1",
    );
  });

  it("uploads profile images as multipart form data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(201, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["image"], "device.jpg", { type: "image/jpeg" });
    await api.devices.uploadProfileImages("device-1", [file]);
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Headers).has("Content-Type")).toBe(false);
  });
});
