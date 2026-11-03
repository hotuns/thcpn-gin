import { describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  authStorage,
  adminAuthStorage,
  authClearedEvent,
  adminAuthClearedEvent,
  formatApiError,
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
