import { useQuery } from "@tanstack/react-query";
import { api, type SystemPolicy } from "@thcpn/api";

let snapshot: SystemPolicy | undefined;
export function policyLimit(key: string, fallback: number): number {
  return snapshot?.values[key] ?? fallback;
}
export function useSystemPolicy() {
  return useQuery({
    queryKey: ["system-policy"],
    queryFn: async () => { const result = await api.systemPolicy(); snapshot = result; return result; },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
export function usePolicyLimit(key: string, fallback: number): number {
  const query = useSystemPolicy();
  return query.data?.values[key] ?? fallback;
}
