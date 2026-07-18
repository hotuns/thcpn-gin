import { type ReactNode } from "react";
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
import { api, deviceStatusLabel, formatApiError } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";

const text = (input: unknown, fallback: unknown = "—") =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const displayTime = (input: unknown) =>
  input
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(String(input)))
    : "—";
export const countState = (loading: boolean, error: unknown, count?: number) =>
  loading
    ? { value: "…", meta: "正在加载" }
    : error
      ? { value: "—", meta: "查询失败" }
      : { value: String(count ?? 0), meta: "当前工作区" };

export function DashboardPage() {
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
  const queries = [projects, sites, devices, datasets, exports, audit];
  if (workspaceError) {
    const item = formatApiError(workspaceError);
    return (
      <>
        <PageHeader
          eyebrow="工作区 / 概览"
          title="总览"
          description="工作区暂时不可用。"
        />
        <Panel>
          <StateView
            type="error"
            title="工作区加载失败"
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
          eyebrow="工作区 / 概览"
          title="总览"
          description="选择工作区后查看资源运行概览。"
        />
        <Panel>
          <StateView
            type="empty"
            title="没有可用工作区"
            description="创建组织工作区，或联系管理员加入已有空间。"
          />
        </Panel>
      </>
    );
  const metrics = [
    {
      label: "项目",
      icon: <Building2 size={16} />,
      ...countState(
        projects.isLoading,
        projects.error,
        projects.data?.items.length,
      ),
    },
    {
      label: "站点",
      icon: <MapPin size={16} />,
      ...countState(sites.isLoading, sites.error, sites.data?.items.length),
    },
    {
      label: "设备",
      icon: <Truck size={16} />,
      ...countState(
        devices.isLoading,
        devices.error,
        devices.data?.items.length,
      ),
    },
    {
      label: "数据集",
      icon: <Table2 size={16} />,
      ...countState(
        datasets.isLoading,
        datasets.error,
        datasets.data?.items.length,
      ),
    },
    {
      label: "导出任务",
      icon: <Download size={16} />,
      ...countState(
        exports.isLoading,
        exports.error,
        exports.data?.items.length,
      ),
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="工作区 / 概览"
        title="总览"
        description={`正在查看 ${current?.name ?? "当前工作区"} 的资源、任务与安全事件。`}
        actions={
          <Button
            variant="secondary"
            onClick={() => queries.forEach((query) => void query.refetch())}
          >
            <RefreshCw size={14} />
            刷新全部
          </Button>
        }
      />
      <div className="dashboard-metrics">
        {metrics.map((item) => (
          <Panel
            className={`metric ${item.meta === "查询失败" ? "metric-error" : ""}`}
            key={item.label}
          >
            <div className="metric-top">
              <span className="metric-label">{item.label}</span>
              {item.icon}
            </div>
            <div className="metric-value">{item.value}</div>
            <div className="metric-meta neutral">{item.meta}</div>
          </Panel>
        ))}
      </div>
      <div className="grid grid-2 section-gap">
        <DashboardList
          title="设备状态"
          subtitle="最近分配的设备资产"
          link="/devices"
          query={devices}
        >
          {devices.data?.items.slice(0, 5).map((device) => (
            <div className="series-row" key={device.id}>
              <div>
                <div className="cell-title">{device.name}</div>
                <div className="cell-sub mono">{device.serial_no}</div>
              </div>
              <Badge tone={device.status === "active" ? "success" : "warning"}>
                {deviceStatusLabel(device.status)}
              </Badge>
            </div>
          ))}
        </DashboardList>
        <DashboardList
          title="最近导出"
          subtitle="当前账号发起的异步任务"
          link="/exports"
          query={exports}
        >
          {exports.data?.items.slice(0, 5).map((job) => (
            <div className="series-row" key={job.id}>
              <div>
                <div className="cell-title">{job.export_type}</div>
                <div className="cell-sub">
                  {job.resource_type} ·{" "}
                  <span className="mono">{job.id.slice(0, 10)}</span>
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
            <h2 className="panel-title">最近审计</h2>
            <div className="panel-kicker">敏感操作、访问结果和 request ID</div>
          </div>
          <Link className="admin-link" to="/settings?tab=audit">
            查看全部
          </Link>
        </div>
        {audit.isLoading ? (
          <StateView
            type="loading"
            title="正在加载审计事件"
            description="正在读取当前工作区的安全记录。"
          />
        ) : audit.error ? (
          <StateView
            type="error"
            title="审计日志不可用"
            description={formatApiError(audit.error).message}
            requestId={formatApiError(audit.error).requestId}
          />
        ) : audit.data?.items.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>资源</th>
                  <th>结果</th>
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
                      {text(item.resource_type)}
                      <div className="cell-sub mono">
                        {text(item.resource_id)}
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
            </table>
          </div>
        ) : (
          <StateView
            type="empty"
            title="暂无审计事件"
            description="当前工作区还没有可见的敏感操作记录。"
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
  return (
    <Panel>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
          <div className="panel-kicker">{subtitle}</div>
        </div>
        <Link className="admin-link" to={link}>
          查看全部
        </Link>
      </div>
      {query.isLoading ? (
        <StateView
          type="loading"
          title={`正在加载${title}`}
          description="正在读取服务端数据。"
        />
      ) : query.error ? (
        <StateView
          type="error"
          title={`${title}不可用`}
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
        />
      ) : query.data?.items.length ? (
        <div className="series-list">{children}</div>
      ) : (
        <StateView
          type="empty"
          title={`暂无${title}`}
          description="当前工作区暂无相关记录。"
        />
      )}
    </Panel>
  );
}
