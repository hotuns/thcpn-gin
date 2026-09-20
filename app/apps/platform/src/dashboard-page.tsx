import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Download,
  MapPin,
  RefreshCw,
  Table2,
  Truck,
} from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { domainLabels, useLocale } from "@thcpn/i18n";
import { Badge, Button, PageHeader, Panel, StateView, Table } from "./platform-ui";

const text = (input: unknown, fallback: unknown = "—") =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const displayTime = (input: unknown) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(String(input)))
    : "—";
export const countState = (loading: boolean, error: unknown, count?: number, labels = { loading: "正在加载", error: "查询失败", current: "当前组织" }) =>
  loading
    ? { value: "…", meta: labels.loading }
    : error
      ? { value: "—", meta: labels.error }
      : { value: String(count ?? 0), meta: labels.current };

export function DashboardPage() {
  const { t } = useLocale();
  const labels = domainLabels(t);
  const countLabels = { loading: t("platform:dashboard.loading"), error: t("platform:dashboard.queryFailed"), current: t("platform:dashboard.currentWorkspace") };
  const exportTypeLabel = (type: unknown) => t(`platform:dashboard.exportTypes.${String(type)}`, { defaultValue: text(type) });
  const { current, currentId, error: workspaceError } = useWorkspace();
  const projects = useQuery({
    queryKey: workspaceQueryKey(currentId, "projects"),
    queryFn: () => api.projects.list(currentId!),
    enabled: Boolean(currentId),
  });
  const sites = useQuery({
    queryKey: workspaceQueryKey(currentId, "sites"),
    queryFn: () => api.sites.list(currentId!),
    enabled: Boolean(currentId),
  });
  const devices = useQuery({
    queryKey: workspaceQueryKey(currentId, "devices"),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
  });
  const datasets = useQuery({
    queryKey: workspaceQueryKey(currentId, "datasets"),
    queryFn: () => api.datasets.list(currentId!),
    enabled: Boolean(currentId),
  });
  const exports = useQuery({
    queryKey: workspaceQueryKey(currentId, "exports"),
    queryFn: () => api.exports.list(currentId!),
    enabled: Boolean(currentId),
  });
  const audit = useQuery({
    queryKey: workspaceQueryKey(currentId, "audit", "recent"),
    queryFn: () => api.audit.list(currentId!, 8),
    enabled: Boolean(currentId),
  });
  const auditResourceNames = useMemo(() => {
    const names = new Map<string, string>();
    const add = (types: string[], id: unknown, name: unknown) => {
      const resourceId = text(id, "");
      if (!resourceId) return;
      types.forEach((type) =>
        names.set(`${type}:${resourceId}`, text(name, resourceId)),
      );
    };
    add(["workspace"], currentId, current?.name);
    (projects.data?.items ?? []).forEach((item) =>
      add(["project"], item.id, item.name),
    );
    (sites.data?.items ?? []).forEach((item) =>
      add(["site"], item.id, item.name),
    );
    (devices.data?.items ?? []).forEach((item) =>
      add(["device"], item.id, item.name),
    );
    (datasets.data?.items ?? []).forEach((item) =>
      add(["dataset"], item.id, item.name),
    );
    (exports.data?.items ?? []).forEach((item) =>
      add(["export", "export_job"], item.id, `${t("platform:dashboard.exportTask")} · ${exportTypeLabel(item.export_type)}`),
    );
    return names;
  }, [current?.name, currentId, datasets.data, devices.data, exports.data, projects.data, sites.data]);
  const exportTargetName = (job: NonNullable<typeof exports.data>["items"][number]) => {
    const deviceIds = Array.isArray(job.request_config?.device_ids)
      ? job.request_config.device_ids.map(String)
      : [];
    const deviceNames = deviceIds
      .map((id) => auditResourceNames.get(`device:${id}`))
      .filter((name): name is string => Boolean(name));
    if (deviceNames.length)
      return `${deviceNames.slice(0, 2).join("、")}${deviceNames.length > 2 ? ` ${t("platform:dashboard.moreDevices", { count: deviceNames.length - 2 })}` : ""}`;
    return (
      auditResourceNames.get(`${job.resource_type}:${job.resource_id}`) ??
      `${job.resource_type} · ${job.resource_id.slice(0, 8)}…`
    );
  };
  const queries = [projects, sites, devices, datasets, exports, audit];
  if (workspaceError) {
    const item = formatApiError(workspaceError);
    return (
      <>
        <PageHeader
          eyebrow={t("platform:dashboard.eyebrow")}
          title={t("platform:dashboard.title")}
          description={t("platform:dashboard.unavailable")}
        />
        <Panel>
          <StateView
            type="error"
            title={t("platform:dashboard.workspaceLoadFailed")}
            description={item.message}
            requestId={item.requestId}
          />
        </Panel>
      </>
    );
  }
  if (!currentId)
    return (
      <>
        <PageHeader
          eyebrow={t("platform:dashboard.eyebrow")}
          title={t("platform:dashboard.title")}
          description={t("platform:dashboard.selectWorkspace")}
        />
        <Panel>
          <StateView
            type="empty"
            title={t("platform:dashboard.noWorkspace")}
            description={t("platform:dashboard.noWorkspaceDescription")}
          />
        </Panel>
      </>
    );
  const metrics = [
    {
      label: t("platform:dashboard.projects"),
      href: "/settings?tab=resources",
      icon: <Building2 size={16} />,
      ...countState(
        projects.isLoading,
        projects.error,
        projects.data?.items.length, countLabels,
      ),
    },
    {
      label: t("platform:dashboard.sites"),
      href: "/settings?tab=resources",
      icon: <MapPin size={16} />,
      ...countState(sites.isLoading, sites.error, sites.data?.items.length, countLabels),
    },
    {
      label: t("platform:dashboard.devices"),
      href: "/devices",
      icon: <Truck size={16} />,
      ...countState(
        devices.isLoading,
        devices.error,
        devices.data?.items.length, countLabels,
      ),
    },
    {
      label: t("platform:dashboard.datasets"),
      href: "/datasets",
      icon: <Table2 size={16} />,
      ...countState(
        datasets.isLoading,
        datasets.error,
        datasets.data?.items.length, countLabels,
      ),
    },
    {
      label: t("platform:dashboard.exportJobs"),
      href: "/exports",
      icon: <Download size={16} />,
      ...countState(
        exports.isLoading,
        exports.error,
        exports.data?.items.length, countLabels,
      ),
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow={t("platform:dashboard.eyebrow")}
        title={t("platform:dashboard.title")}
        description={t("platform:dashboard.viewing", { name: current?.name ?? t("platform:dashboard.currentWorkspace") })}
        actions={
          <Button
            variant="secondary"
            onClick={() => queries.forEach((query) => void query.refetch())}
          >
            <RefreshCw size={14} />
            {t("platform:dashboard.refreshAll")}
          </Button>
        }
      />
      <div className="dashboard-metrics">
        {metrics.map((item) => (
          <Link className="dashboard-metric-link" to={item.href} key={item.label} aria-label={t("platform:dashboard.viewMetric", { name: item.label })}>
            <Panel className={`metric ${item.meta === countLabels.error ? "metric-error" : ""}`}>
              <div className="metric-top">
                <span className="metric-label">{item.label}</span>
                {item.icon}
              </div>
              <div className="metric-value">{item.value}</div>
              <div className="metric-meta neutral">{item.meta}</div>
            </Panel>
          </Link>
        ))}
      </div>
      <div className="grid grid-2 section-gap">
        <DashboardList
          title={t("platform:dashboard.deviceStatus")}
          subtitle={t("platform:dashboard.recentDevices")}
          link="/devices"
          query={devices}
        >
          {devices.data?.items.slice(0, 5).map((device) => (
            <div className="series-row" key={device.id}>
              <div>
                <div className="cell-title">{device.name}</div>
                <div className="cell-sub mono">SN {device.serial_no}</div>
              </div>
              <Badge tone={device.status === "active" ? "success" : "warning"}>
                {labels.deviceStatus(device.status)}
              </Badge>
            </div>
          ))}
        </DashboardList>
        <DashboardList
          title={t("platform:dashboard.recentExports")}
          subtitle={t("platform:dashboard.recentExportsDescription")}
          link="/exports"
          query={exports}
        >
          {exports.data?.items.slice(0, 5).map((job) => (
            <div className="series-row" key={job.id}>
              <div>
                <div className="cell-title">{exportTypeLabel(job.export_type)}</div>
                <div className="cell-sub">
                  {exportTargetName(job)} ·{" "}
                  <span className="mono">{job.id.slice(0, 8)}…</span>
                </div>
              </div>
              <Badge
                tone={
                  job.status === "success"
                    ? "success"
                    : job.status === "failed"
                      ? "danger"
                      : "warning"
                }
              >
                {job.status}
              </Badge>
            </div>
          ))}
        </DashboardList>
      </div>
      <Panel className="section-gap">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{t("platform:dashboard.recentAudit")}</h2>
            <div className="panel-kicker">{t("platform:dashboard.recentAuditDescription")}</div>
          </div>
          <Link className="admin-link" to="/settings?tab=audit">
            {t("platform:dashboard.viewAll")}
          </Link>
        </div>
        {audit.isLoading ? (
          <StateView
            type="loading"
            title={t("platform:dashboard.auditLoading")}
            description={t("platform:dashboard.auditLoadingDescription")}
          />
        ) : audit.error ? (
          <StateView
            type="error"
            title={t("platform:dashboard.auditUnavailable")}
            description={formatApiError(audit.error).message}
            requestId={formatApiError(audit.error).requestId}
          />
        ) : audit.data?.items.length ? (
          <div className="table-wrap">
            <Table className="data-table">
              <thead>
                <tr>
                  <th>{t("platform:dashboard.time")}</th>
                  <th>{t("platform:dashboard.action")}</th>
                  <th>{t("platform:dashboard.resource")}</th>
                  <th>{t("platform:dashboard.result")}</th>
                  <th>Request ID</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((item) => (
                  <tr key={text(item.id)}>
                    <td>{displayTime(item.created_at)}</td>
                    <td>
                      <div className="cell-title">{text(item.action)}</div>
                      <div className="cell-sub">{text(item.actor_type)}</div>
                    </td>
                    <td>
                      <div className="cell-title">
                        {auditResourceNames.get(
                          `${text(item.resource_type, "unknown")}:${text(item.resource_id, "")}`,
                        ) ?? text(item.resource_type)}
                      </div>
                      <div className="cell-sub">
                        {text(item.resource_type)} ·{" "}
                        <span className="mono">
                          {text(item.resource_id).slice(0, 8)}…
                        </span>
                      </div>
                    </td>
                    <td>
                      <Badge
                        tone={item.result === "success" ? "success" : "danger"}
                      >
                        {text(item.result)}
                      </Badge>
                      {Boolean(item.reason) && (
                        <div className="cell-sub audit-reason">
                          {text(item.reason)}
                        </div>
                      )}
                    </td>
                    <td className="mono">{text(item.request_id)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <StateView
            type="empty"
            title={t("platform:dashboard.noAudit")}
            description={t("platform:dashboard.noAuditDescription")}
          />
        )}
      </Panel>
    </>
  );
}
function DashboardList({
  title,
  subtitle,
  link,
  query,
  children,
}: {
  title: string;
  subtitle: string;
  link: string;
  query: any;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <Panel>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
          <div className="panel-kicker">{subtitle}</div>
        </div>
        <Link className="admin-link" to={link}>
          {t("platform:dashboard.viewAll")}
        </Link>
      </div>
      {query.isLoading ? (
        <StateView
          type="loading"
          title={`${t("platform:dashboard.loading")} ${title}`}
          description={t("platform:dashboard.reading")}
        />
      ) : query.error ? (
        <StateView
          type="error"
          title={`${title}${t("platform:dashboard.unavailableSuffix")}`}
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
        />
      ) : query.data?.items.length ? (
        <div className="series-list">{children}</div>
      ) : (
        <StateView
          type="empty"
          title={`${t("platform:dashboard.emptyPrefix")}${title}`}
          description={t("platform:dashboard.noRecords")}
        />
      )}
    </Panel>
  );
}
