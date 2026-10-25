import { setWorkerUrl } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@thcpn/auth";
import { WorkspaceProvider } from "@thcpn/workspace";
import { I18nProvider } from "@thcpn/i18n";
import "@thcpn/ui/styles.css";
import "./platform.css";
import "./shadcn.css";
import "./platform-refinement.css";
import { PlatformApp } from "./app";
import { ColorThemeProvider } from "./color-theme";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 0 } } });

// Bundle the MapLibre v6 worker and its shared chunk before any map mounts.
setWorkerUrl(mapWorkerUrl);
createRoot(document.getElementById("root")!).render(<StrictMode><I18nProvider><ColorThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><AuthProvider><PlatformApp /></AuthProvider></BrowserRouter></QueryClientProvider></ColorThemeProvider></I18nProvider></StrictMode>);
