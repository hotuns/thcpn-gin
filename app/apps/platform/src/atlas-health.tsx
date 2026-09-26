import { useQuery } from "@tanstack/react-query";
import { api, type THCPNDeviceRuntimeBatchResponse } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { useLocale } from "@thcpn/i18n";

export function reportingCounts(
  ids: string[],
  runtime: THCPNDeviceRuntimeBatchResponse | undefined,
  now: number,
) {
  const failed = new Set(runtime?.failures.map((item) => item.device_id));
  const records = new Map(runtime?.items.map((item) => [item.device_id, item]));
  const result = { total: ids.length, normal: 0, overdue: 0, unknown: 0 };
  for (const id of ids) {
    const record = failed.has(id) ? undefined : records.get(id);
    const times = Object.values(record?.attributes ?? {})
      .map((value) => Date.parse(value.sampled_at))
      .filter((value) => Number.isFinite(value) && value > 0 && value <= now);
    const latest = times.length ? Math.max(...times) : undefined;
    if (latest === undefined) result.unknown++;
    else if (now - latest <= 86400000) result.normal++;
    else result.overdue++;
  }
  return result;
}

export function AtlasHealth({
  workspaceId,
  deviceIds,
  loading,
}: {
  workspaceId: string;
  deviceIds: string[];
  loading: boolean;
}) {
  const { t } = useLocale();
  const a = (key: string) => t(`atlas.${key}`);
  const ids = [...new Set(deviceIds)].sort();
  const runtime = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", "runtime", ids.join(",")),
    queryFn: () => api.devices.runtime(ids),
    enabled: !loading && ids.length > 0,
    staleTime: 60000,
    refetchInterval: 60000,
    retry: false,
  });
  const counts = reportingCounts(
    ids,
    runtime.isError ? undefined : runtime.data,
    Date.now(),
  );
  const pending = loading || (ids.length > 0 && runtime.isLoading);
  return (
    <section
      className="atlas-summary atlas-health"
      aria-label={a("reportingOverview")}
    >
      <header>
        <strong>{a("reportingOverview")}</strong>
        <small>{a("reportingWindow")}</small>
      </header>
      <div className="atlas-health-grid">
        {(["total", "normal", "overdue", "unknown"] as const).map((key) => (
          <div className={`atlas-health-count is-${key}`} key={key}>
            <span>{a(`reporting_${key}`)}</span>
            <strong>
              {(key === "total" ? loading : pending)
                ? "…"
                : counts[key].toString().padStart(2, "0")}
            </strong>
          </div>
        ))}
      </div>
      <footer title={a("reportingHint")}>
        {runtime.isError ? a("reportingUnavailable") : a("reportingHint")}
      </footer>
    </section>
  );
}
