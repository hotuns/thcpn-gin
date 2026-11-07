import { useQuery } from "@tanstack/react-query";
import { api } from "@thcpn/api";

export function usePlatformBaseUrl(buildTimeUrl?: string) {
  const policy = useQuery({ queryKey: ["system-policy"], queryFn: api.systemPolicy, staleTime: 30_000 });
  const fallback = window.location.origin.replace(/:5174$/, ":5173");
  return (policy.data?.public_base_url || buildTimeUrl || import.meta.env.VITE_PLATFORM_URL || fallback).replace(/\/+$/, "");
}
