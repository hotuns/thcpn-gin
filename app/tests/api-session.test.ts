import { describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  apiErrorEvent,
  authStorage,
  adminAuthStorage,
  authClearedEvent,
  adminAuthClearedEvent,
  formatApiError,
  formatApiErrorText,
} from "@thcpn/api";

const contexts = [
  { name: "platform", path: "/devices", storage: authStorage, other: adminAuthStorage, cleared: authClearedEvent, request: () => api.me.get(), refresh: "/api/v1/auth/refresh" },
  { name: "admin", path: "/admin/devices", storage: adminAuthStorage, other: authStorage, cleared: adminAuthClearedEvent, request: () => api.adminAuth.me(), refresh: "/api/v1/admin/auth/refresh" },
];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

for (const context of contexts) {
  describe(`${context.name} session requests`, () => {
    function startSession() {
      window.history.replaceState(null, "", context.path);
      context.storage.write({ accessToken: "expired-access", refreshToken: "refresh-token" });
      context.other.write({ accessToken: "other-access", refreshToken: "other-refresh" });
    }

    it("refreshes an expired session and retries with its own new token", async () => {
      startSession();
      const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(json(401, { error: { code: "UNAUTHORIZED" } }))
        .mockResolvedValueOnce(json(200, { access_token: "renewed-access", refresh_token: "renewed-refresh" }))
        .mockResolvedValueOnce(json(200, { restored: true }));
      vi.stubGlobal("fetch", fetch);

      await expect(context.request()).resolves.toEqual({ restored: true });

      expect(fetch).toHaveBeenCalledTimes(3);
      const [refreshPath, refreshInit] = fetch.mock.calls[1];
      expect(refreshPath).toBe(context.refresh);
      expect(refreshInit?.method).toBe("POST");
      expect(JSON.parse(String(refreshInit?.body))).toEqual({ refresh_token: "refresh-token" });
      expect(new Headers(fetch.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer expired-access");
      expect(new Headers(fetch.mock.calls[2][1]?.headers).get("Authorization")).toBe("Bearer renewed-access");
      expect(context.storage.read()).toEqual({ accessToken: "renewed-access", refreshToken: "renewed-refresh" });
      expect(context.other.read()?.accessToken).toBe("other-access");
    });

    it("clears only the expired session when refresh is rejected and stops retrying", async () => {
      startSession();
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
        json(401, { error: { code: "UNAUTHORIZED", request_id: "session-expired" } }),
      );
      vi.stubGlobal("fetch", fetch);
      const cleared = vi.fn();
      window.addEventListener(context.cleared, cleared);
      try {
        await expect(context.request()).rejects.toMatchObject({ status: 401, requestId: "session-expired" });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(context.storage.read()).toBeNull();
        expect(context.other.read()?.accessToken).toBe("other-access");
        expect(cleared).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener(context.cleared, cleared);
      }
    });

    it("reports denied access without refreshing or destroying a valid session", async () => {
      startSession();
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(403, {
        error: { code: "PERMISSION_DENIED", request_id: "permission-denied" },
      }));
      vi.stubGlobal("fetch", fetch);

      await expect(context.request()).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED", requestId: "permission-denied" });
      expect(fetch).toHaveBeenCalledOnce();
      expect(context.storage.read()?.refreshToken).toBe("refresh-token");
    });
  });
}

it("keeps actionable validation details and the request ID for form errors", () => {
  const error = new ApiError("time range cannot exceed 366 days", 400, "range-check", undefined, "INVALID_ARGUMENT");
  expect(formatApiError(error)).toMatchObject({
    message: "time range cannot exceed 366 days",
    status: 400,
    requestId: "range-check",
  });
});

it("handles HTTP/2 empty statusText non-JSON proxy errors without returning blank copy", async () => {
  window.history.replaceState(null, "", "/devices");
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
    new Response("<html>413 Request Entity Too Large</html>", { status: 413, statusText: "" }),
  );
  vi.stubGlobal("fetch", fetch);

  let caught: unknown;
  try {
    await api.me.get();
  } catch (error) {
    caught = error;
  }
  const formatted = formatApiError(caught);
  expect(formatted.status).toBe(413);
  expect(formatted.message).toContain("上传内容过大");
});

it("does not refresh token or retry when changePassword rejects with current password is incorrect", async () => {
  window.history.replaceState(null, "", "/account");
  authStorage.write({ accessToken: "valid-access", refreshToken: "refresh-token" });
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
    json(401, { error: { code: "UNAUTHORIZED", message: "current password is incorrect", request_id: "pwd-1" } }),
  );
  vi.stubGlobal("fetch", fetch);

  await expect(api.auth.changePassword({ current_password: "wrong", new_password: "newpassword1" }))
    .rejects.toMatchObject({ status: 401, message: "current password is incorrect" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(formatApiError(new ApiError("current password is incorrect", 401, "pwd-1", undefined, "UNAUTHORIZED")).message)
    .toBe("当前密码不正确，请重新输入");
});

it("translates high-frequency 401/409 errors and formats admin 5xx guidance with requestId", () => {
  window.history.replaceState(null, "", "/login");
  expect(formatApiError(new ApiError("user is not active", 401, "u-1", undefined, "UNAUTHORIZED")).message)
    .toBe("账号已停用，请联系管理员");
  expect(formatApiError(new ApiError("phone or email already exists", 409, "c-1", undefined, "CONFLICT")).message)
    .toBe("手机号或邮箱已被注册，请直接登录或更换后重试");
  expect(formatApiError(new ApiError("invalid public access password", 401, "p-1", undefined, "UNAUTHORIZED")).message)
    .toBe("访问密码不正确，请重新输入");

  window.history.replaceState(null, "", "/admin/devices");
  const adminErr = new ApiError("service temporarily unavailable", 502, "req-admin-502", undefined, "DATA_SOURCE_ERROR");
  const adminText = formatApiErrorText(adminErr);
  expect(adminText).not.toContain("联系系统管理员");
  expect(adminText).toContain("平台日志");
  expect(adminText).toContain("req-admin-502");
});

it("does not dispatch global apiErrorEvent for AbortError", async () => {
  window.history.replaceState(null, "", "/devices");
  const abortError = new DOMException("Aborted", "AbortError");
  vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockRejectedValueOnce(abortError));
  const listener = vi.fn();
  window.addEventListener(apiErrorEvent, listener);
  try {
    await expect(api.me.get()).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(apiErrorEvent, listener);
  }
});
