import "./dashboard.css";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight, Bell, Camera, Database, Info, RadioTower, RefreshCw, type LucideIcon } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { useLocale } from "@thcpn/i18n";
import { Button, PageHeader, Panel, StateView } from "../../shared/ui";
import { DashboardTrend } from "./dashboard-trend";

export function DashboardPage() {
  const { t } = useLocale();
  const { current, loading, error, refresh } = useWorkspace();
  if (!current || error) {
    const failure = error ? formatApiError(error) : null;
    return <div className="observation-overview">
      <PageHeader title={t("platform:overview.title")} />
      <Panel><StateView type={failure ? "error" : loading ? "loading" : "empty"}
        title={t(`platform:overview.${failure ? "workspaceFailed" : loading ? "loading" : "noWorkspace"}`)}
        description={failure?.message ?? (loading ? "" : t("platform:overview.noWorkspaceHelp"))}
        requestId={failure?.requestId} />
        {failure && <Button variant="secondary" onClick={() => void refresh()}>{t("platform:overview.retry")}</Button>}
      </Panel>
    </div>;
  }
  // Remount local range/interaction state at the workspace boundary. No placeholder
  // or cached count from another workspace may appear during its first request.
  return <WorkspaceOverview key={current.id} workspaceId={current.id} workspaceName={current.name} />;
}

function WorkspaceOverview({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const { t, locale, formatNumber } = useLocale();
  const [days, setDays] = useState<7 | 30>(7);
  // The API keeps totals all-time; days scopes only trend buckets. The keyed
  // workspace boundary makes keeping the previous range safe during refetches.
  const summary = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "dashboard", String(days)),
    queryFn: () => api.dashboard(workspaceId, days),
    placeholderData: (previous) => previous,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const data = summary.data;
  const busy = summary.isFetching;
  const preparing = data?.refresh_interval_seconds === 5;
  const refresh = () => { void summary.refetch(); };
  const count = (value: number | null | undefined) => value == null ? t(`platform:overview.${!data && busy ? "loadingValue" : "unknown"}`) : formatNumber(value);
  const time = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: data?.timezone ?? "UTC",
  }).format(new Date(value));
  const counts = data ? [data.records.total, data.images.total, data.records.today, data.images.today] : [];
  const allUnknown = counts.length > 0 && counts.every((item) => item.value === null);
  const reportingUnknown = data && data.devices.reporting === 0
    && data.devices.total > data.devices.inactive
    && data.devices.unknown >= data.devices.total - data.devices.inactive;
  const error = summary.error ? formatApiError(summary.error) : null;

  return <div className="observation-overview">
    <PageHeader eyebrow={t("platform:overview.workspace", { name: workspaceName })}
      title={t("platform:overview.title")}
      actions={<Button variant="secondary" disabled={busy} onClick={refresh}><RefreshCw size={16} aria-hidden="true" className={busy ? "overview-refresh-spin" : undefined} />{t(`platform:overview.${busy ? data ? "refreshing" : "loadingValue" : "refresh"}`)}</Button>} />
    {error && <div className="overview-notice" role="alert">
      <strong>{t(`platform:overview.${data ? "refreshFailed" : "failed"}`)}</strong>
      <span>{error.message}</span>
      {error.requestId && <span>{t("common:requestId", { id: error.requestId })}</span>}
      <Button variant="secondary" onClick={refresh} disabled={busy}>{t("platform:overview.retry")}</Button>
    </div>}
    {busy && <p className="sr-only" role="status">{t(`platform:overview.${data ? "refreshing" : "loading"}`)}</p>}
    {data?.devices.total === 0 && <div className="overview-notice"><strong>{t("platform:overview.noDevices")}</strong><span>{t("platform:overview.noDevicesHelp")}</span></div>}
    {allUnknown && !preparing && <p className="overview-notice" role="status">{t("platform:overview.allUnknown")}</p>}

    <section className="overview-statistics" aria-busy={busy}>
      <div className="overview-metrics">
        <Metric id="records" icon={Database} label={t("platform:overview.records")} value={count(data?.records.total.value)} featured>
          <p>{t("platform:overview.recordsHelp")}</p>
          {data && <p>{data.records.first_observed_at ? t("platform:overview.firstObserved", { time: time(data.records.first_observed_at) }) : t("platform:overview.firstUnknown")}</p>}
        </Metric>
        <Metric id="images" icon={Camera} label={t("platform:overview.images")} value={count(data?.images.total.value)} />
        <Metric id="today" icon={Activity} label={t("platform:overview.today")} value={count(data?.records.today.value)}>
          <p>{t("platform:overview.todayImages", { value: count(data?.images.today.value) })}</p>
        </Metric>
        <Metric id="reporting" icon={RadioTower} label={t("platform:overview.reporting")} value={count(reportingUnknown ? null : data?.devices.reporting)}>
          {data && <p>{t("platform:overview.deviceCounts", { total: formatNumber(data.devices.total), unknown: formatNumber(data.devices.unknown), inactive: formatNumber(data.devices.inactive) })}</p>}
          <details className="overview-status-help"><summary>{t("platform:overview.reportingHelpTitle")}</summary><p>{t("platform:overview.reportingHelp")}</p></details>
        </Metric>
      </div>
      <div className="overview-metadata">
        <span>{t("platform:overview.timezone", { timezone: data?.timezone ?? t("platform:overview.unknown") })}</span>
        <span><Activity size={14} aria-hidden="true" />{data?.statistics_updated_at ? t("platform:overview.updated", { time: time(data.statistics_updated_at) }) : t("platform:overview.updatedUnknown")}</span>
      </div>
    </section>
    {preparing && <p className="overview-notice" role="status"><Info size={16} aria-hidden="true" />{t("platform:overview.preparing")}</p>}

    <div className="overview-content">
      <DashboardTrend days={days} onDaysChange={setDays} data={data} busy={busy}
        placeholder={summary.isPlaceholderData} error={summary.error} onRetry={refresh} />

      <div className="overview-bottom">
        <Panel className="overview-attention">
          <div className="overview-section-heading">
            <h2>{t("platform:overview.attention")}</h2>
            <Link className="overview-section-link" to="/devices">{t("platform:overview.viewDevices")}<ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
          {!data ? <p>{t(`platform:overview.${error ? "attentionUnavailable" : "loading"}`)}</p> : <>
            {(allUnknown || data.devices.unknown > 0) && <p className="overview-notice">{t(`platform:overview.${allUnknown ? "attentionUnavailable" : "attentionUnknown"}`)}</p>}
            {data.attention.length ? <ul className="overview-device-list">{data.attention.map((device) => <li key={device.id}>
              <div><Link to={`/devices/${encodeURIComponent(device.device_id)}`}>{device.name || device.device_id}</Link><p>{device.last_observed_at ? t("platform:overview.lastObserved", { time: time(device.last_observed_at) }) : t("platform:overview.lastUnknown")}</p>
                {device.threshold_seconds != null && <p>{t("platform:overview.threshold", { seconds: formatNumber(device.threshold_seconds) })}</p>}</div>
              <span className="overview-device-state" data-kind={device.kind}>{t(`platform:overview.${device.kind}`)}</span>
            </li>)}</ul> : !allUnknown && data.devices.unknown === 0 && <p>{t("platform:overview.noAttention")}</p>}
          </>}
        </Panel>
        <Panel className="overview-alerts">
          <div className="overview-section-heading">
            <h2><span className="overview-metric-icon"><Bell size={17} aria-hidden="true" /></span>{t("platform:overview.alerts")}</h2>
            <Link className="overview-section-link" to="/alerts">{t("platform:overview.viewAlerts")}<ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
          <div className="overview-alert-count">{count(data?.active_alerts)}</div>
        </Panel>
      </div>
    </div>
  </div>;
}

function Metric({ id, icon: Icon, label, value, featured, children }: { id: string; icon: LucideIcon; label: string; value: string; featured?: boolean; children?: ReactNode }) {
  return <section className={`overview-metric${featured ? " overview-metric-featured" : ""}`} aria-labelledby={`overview-${id}-label`}>
    <h2 id={`overview-${id}-label`}><span className="overview-metric-icon"><Icon size={17} aria-hidden="true" /></span>{label}</h2>
    <div key={value} className="overview-value" data-testid={`overview-${id}`}>{value}</div>
    {children && <div className="overview-metric-notes">{children}</div>}
  </section>;
}
