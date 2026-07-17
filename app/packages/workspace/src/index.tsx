import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AccessibleWorkspace } from "@thcpn/api";

type WorkspaceContextValue = {
  workspaces: AccessibleWorkspace[];
  current: AccessibleWorkspace | null;
  currentId: string | null;
  setCurrentId: (id: string) => void;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
};

const storageKey = "thcpn.workspace.current";
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const resolveWorkspaceId = (persistedId: string | null, workspaces: Array<{ id: string }>) => {
  if (!workspaces.length) return null;
  return persistedId && workspaces.some((workspace) => workspace.id === persistedId) ? persistedId : workspaces[0].id;
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces.list });
  const [currentId, setCurrentIdState] = useState<string | null>(() => localStorage.getItem(storageKey));
  const workspaces = useMemo<AccessibleWorkspace[]>(() => (query.data?.items ?? []).map(({ workspace, membership }) => ({ ...workspace, membership })), [query.data]);

  useEffect(() => {
    if (!workspaces.length) return;
    const resolved = resolveWorkspaceId(currentId, workspaces);
    if (resolved !== currentId && resolved) {
      setCurrentIdState(resolved);
      localStorage.setItem(storageKey, resolved);
    }
  }, [currentId, workspaces]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    workspaces,
    current: workspaces.find((workspace) => workspace.id === currentId) ?? null,
    currentId,
    setCurrentId: (id) => {
      setCurrentIdState(id);
      localStorage.setItem(storageKey, id);
      queryClient.invalidateQueries({ predicate: (item) => item.queryKey[0] !== "workspaces" });
    },
    loading: query.isLoading,
    error: query.error,
    refresh: async () => { await query.refetch(); }
  }), [currentId, query.data, query.error, query.isLoading, queryClient, workspaces]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}

export const workspaceQueryKey = (workspaceId: string | null, ...parts: string[]) => ["workspace", workspaceId, ...parts];
