import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AdminAuthProvider } from "@thcpn/auth";
import { AdminProvider } from "@thcpn/admin-ui";
import "antd/dist/reset.css";
import "@thcpn/ui/styles.css";
import "./admin.css";
import { AdminApp } from "./app";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 0 } } });
createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><AdminAuthProvider><AdminProvider><AdminApp /></AdminProvider></AdminAuthProvider></BrowserRouter></QueryClientProvider></StrictMode>);
