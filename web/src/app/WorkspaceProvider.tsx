import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceStorage, workspacesApi, type WorkspaceWithMembership } from "../api";
import { useAuth } from "./AuthProvider";

interface WorkspaceContextValue {
  workspaces: WorkspaceWithMembership[];
  selectedWorkspaceId: string;
  selectedWorkspace?: WorkspaceWithMembership;
  setSelectedWorkspaceId: (workspaceId: string) => void;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [selectedWorkspaceId, setSelectedWorkspaceIdState] = useState(workspaceStorage.read());
  const query = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspacesApi.list,
    enabled: isAuthenticated
  });

  const workspaces = query.data?.items ?? [];
  const selectedWorkspace = useMemo(
    () => workspaces.find((item) => item.workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, workspaces]
  );

  useEffect(() => {
    if (!workspaces.length) {
      return;
    }
    if (!selectedWorkspaceId || !workspaces.some((item) => item.workspace.id === selectedWorkspaceId)) {
      const fallback = workspaces[0].workspace.id;
      workspaceStorage.write(fallback);
      setSelectedWorkspaceIdState(fallback);
    }
  }, [selectedWorkspaceId, workspaces]);

  const setSelectedWorkspaceId = (workspaceId: string) => {
    workspaceStorage.write(workspaceId);
    setSelectedWorkspaceIdState(workspaceId);
  };

  const value = useMemo(
    () => ({
      workspaces,
      selectedWorkspaceId,
      selectedWorkspace,
      setSelectedWorkspaceId,
      isLoading: query.isLoading,
      error: query.error,
      refetch: () => void query.refetch()
    }),
    [query, selectedWorkspace, selectedWorkspaceId, workspaces]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return context;
}
