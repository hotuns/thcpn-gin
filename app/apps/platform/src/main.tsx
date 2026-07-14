import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@thcpn/auth";
import { WorkspaceProvider } from "@thcpn/workspace";
import "@thcpn/ui/styles.css";
import "./platform.css";
import { PlatformApp } from "./app";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 0 } } });

createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><AuthProvider><PlatformApp /></AuthProvider></BrowserRouter></QueryClientProvider></StrictMode>);
