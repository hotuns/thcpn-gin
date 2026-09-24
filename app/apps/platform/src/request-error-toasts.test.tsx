// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { toast } from "sonner";
import { RequestErrorToasts } from "./request-error-toasts";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() }, Toaster: () => null }));
vi.mock("@thcpn/api", () => ({ apiErrorEvent: "test-api-error", formatApiError: (error: unknown) => error }));
vi.mock("@thcpn/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("reuses one toast for request errors and removes its listener on unmount", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<RequestErrorToasts />));
  const emit = (status: number) => window.dispatchEvent(new CustomEvent("test-api-error", {
    detail: { status, message: "Request failed", requestId: "trace-123" },
  }));
  emit(404);
  expect(toast.error).toHaveBeenLastCalledWith("requestFailed", expect.objectContaining({ id: "global-request-error", duration: 10000 }));
  emit(403);
  expect(toast.error).toHaveBeenLastCalledWith("errors.permission_denied", expect.objectContaining({ id: "global-request-error" }));
  await act(async () => root.unmount());
  expect(toast.dismiss).toHaveBeenCalledWith("global-request-error");
  emit(401);
  expect(toast.error).toHaveBeenCalledTimes(2);
});
