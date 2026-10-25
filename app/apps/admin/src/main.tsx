import { setWorkerUrl } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AdminAuthProvider } from "@thcpn/auth";
import { AdminProvider } from "@thcpn/admin-ui";
import { I18nProvider } from "@thcpn/i18n";
import "antd/dist/reset.css";
import "@thcpn/ui/styles.css";
import "./admin.css";
import { AdminApp } from "./app";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 0 } } });
// Bundle the MapLibre v6 worker and its shared chunk before any map mounts.
setWorkerUrl(mapWorkerUrl);
createRoot(document.getElementById("root")!).render(<StrictMode><I18nProvider><QueryClientProvider client={queryClient}><BrowserRouter><AdminAuthProvider><AdminProvider><AdminApp /></AdminProvider></AdminAuthProvider></BrowserRouter></QueryClientProvider></I18nProvider></StrictMode>);
