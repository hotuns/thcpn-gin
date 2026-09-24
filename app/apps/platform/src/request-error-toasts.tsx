import { useEffect } from "react";
import { toast } from "sonner";
import { apiErrorEvent, formatApiError } from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";
import { Toaster } from "./components/ui/sonner";

const requestToastId = "global-request-error";

export function RequestErrorToasts() {
  const { t } = useLocale();
  useEffect(() => {
    const showError = (event: Event) => {
      const error = formatApiError((event as CustomEvent).detail);
      toast.error(
        error.status === 401 ? t("errors.unauthorized")
          : error.status === 403 ? t("errors.permission_denied") : t("requestFailed"),
        {
          id: requestToastId,
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
      toast.dismiss(requestToastId);
    };
  }, [t]);

  return <Toaster toastOptions={{ closeButtonAriaLabel: t("close") }} />;
}
