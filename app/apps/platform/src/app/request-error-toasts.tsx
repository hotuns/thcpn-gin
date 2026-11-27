import { useEffect } from "react";
import { toast } from "sonner";
import { ApiError, apiErrorEvent, formatApiError } from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";
import { Toaster } from "../shared/ui/primitives/sonner";

const credentialCheckMessages = new Set([
  "current password is incorrect",
  "invalid identifier or password",
  "invalid username or password",
  "invalid mfa code",
  "invalid or missing mfa code",
  "mfa code has already been used",
  "invalid public access password",
  "user is not active",
]);

export function RequestErrorToasts() {
  const { t } = useLocale();
  useEffect(() => {
    const shownIds = new Set<string>();
    const showError = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        (typeof DOMException !== "undefined" && detail instanceof DOMException && detail.name === "AbortError") ||
        (detail instanceof Error && detail.name === "AbortError")
      ) {
        return;
      }
      const error = formatApiError(detail);
      const rawMessage = detail instanceof ApiError ? detail.message.trim() : "";
      const isSessionUnauthorized = error.status === 401 && !credentialCheckMessages.has(rawMessage);
      const toastId = `api-error:${error.status}:${error.code ?? ""}:${error.message}`;
      shownIds.add(toastId);
      toast.error(
        isSessionUnauthorized ? t("errors.unauthorized")
          : error.status === 403 ? t("errors.permission_denied") : t("requestFailed"),
        {
          id: toastId,
          duration: 10000,
          description: <div className="request-toast-details">
            <p>{error.message}</p>
            {error.requestId ? <small>{t("requestId", { id: error.requestId })}</small> : null}
          </div>,
        },
      );
    };
    window.addEventListener(apiErrorEvent, showError);
    return () => {
      window.removeEventListener(apiErrorEvent, showError);
      for (const id of shownIds) toast.dismiss(id);
    };
  }, [t]);

  return <Toaster toastOptions={{ closeButtonAriaLabel: t("close") }} />;
}
