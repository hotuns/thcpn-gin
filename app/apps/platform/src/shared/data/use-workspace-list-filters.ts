import { useEffect, useState } from "react";

// The calling list is keyed by workspace so route remounts restore the correct filters.
export function useWorkspaceListFilters<T>(
  workspaceId: string | null | undefined,
  memory: Map<string, T>,
  defaults: T,
) {
  const [filters, setFilters] = useState(() => (workspaceId && memory.get(workspaceId)) || defaults);
  useEffect(() => {
    if (workspaceId) memory.set(workspaceId, filters);
  }, [workspaceId, memory, filters]);
  return [filters, setFilters] as const;
}
