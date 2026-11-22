import { parsePath } from "react-router-dom";
import type { useNavigationSource } from "../../app/platform-navigation";
import { validDataRange } from "../../shared/data/data-builder";

type NavigationSource = ReturnType<typeof useNavigationSource>;

export function withDeviceQuerySource(source: NavigationSource, query: Record<string, string | string[]>) {
  const { pathname, search, hash } = parsePath(source.navigationSource.to);
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(query)) {
    next.delete(key);
    const values = typeof value === "string" ? [value] : value;
    for (const item of values.length ? values : [""]) next.append(key, item);
  }
  const to = `${pathname ?? ""}?${next}${hash ?? ""}`;
  return { navigationSource: { ...source.navigationSource, to, restoreByUrl: to !== source.navigationSource.to } };
}

export function restoredDeviceRange(params: URLSearchParams) {
  const start = params.get("query_start") ?? "";
  const end = params.get("query_end") ?? "";
  return validDataRange(start, end) ? { start, end } : undefined;
}
