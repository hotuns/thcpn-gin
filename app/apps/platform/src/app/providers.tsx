import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@thcpn/auth";
import { I18nProvider } from "@thcpn/i18n";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { ColorThemeProvider } from "../shared/theme/color-theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 0 } },
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ColorThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ColorThemeProvider>
    </I18nProvider>
  );
}
