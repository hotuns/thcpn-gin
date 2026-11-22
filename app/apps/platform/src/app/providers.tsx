import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@thcpn/auth";
import { I18nProvider } from "@thcpn/i18n";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ColorThemeProvider } from "../shared/theme/color-theme";
import { PlatformApp } from "./app";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 0 } },
});

// The data router supplies navigation blocking to the editor routes.
const router = createBrowserRouter([{ path: "*", element: <PlatformApp /> }]);

export function AppProviders() {
  return (
    <I18nProvider>
      <ColorThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider><RouterProvider router={router} /></AuthProvider>
        </QueryClientProvider>
      </ColorThemeProvider>
    </I18nProvider>
  );
}
