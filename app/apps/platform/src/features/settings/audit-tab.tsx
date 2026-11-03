import "../../shared/data/mobile-data.css";
import "./settings-mobile.css";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { useMemo, useState } from "react";
import { Badge, Input, Panel, StateView, Table } from "../../shared/ui";
import { text } from "./settings-model";


export function AuditTab() {
  const { currentId, current } = useWorkspace();
  const { user } = useAuth();
  const [limit, setLimit] = useState(100);
  const query = useQuery({
    queryKey: workspaceQueryKey(currentId, "audit", String(limit)),
    queryFn: () => api.audit.list(currentId!, limit),
    enabled: Boolean(currentId),
  });
  const members = useQuery({
    queryKey: workspaceQueryKey(currentId, "members"),
    queryFn: () => api.members.list(currentId!),
    enabled: Boolean(currentId),
  });
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
    queryKey: workspaceQueryKey(currentId, "exports", "audit-names"),
    queryFn: () => api.exports.list(currentId!, false, 500),
    enabled: Boolean(currentId),
  });
  const grants = useQuery({
    queryKey: workspaceQueryKey(currentId, "access-grants"),
    queryFn: () => api.accessGrants.list(currentId!),
    enabled: Boolean(currentId),
  });
  const invitations = useQuery({
    queryKey: workspaceQueryKey(currentId, "invitations"),
    queryFn: () => api.invitations.list(currentId!),
    enabled: Boolean(currentId),
  });
  const names = useMemo(() => {
    const actors = new Map<string, string>();
    const resources = new Map<string, string>();
    const addResource = (types: string[], id: unknown, name: unknown) => {
      const key = text(id, "");
      if (!key) return;
      types.forEach((type) => resources.set(`${type}:${key}`, text(name, key)));
    };
    if (user?.id)
      actors.set(user.id, user.name || user.email || user.phone || "当前用户");
    (members.data?.items ?? []).forEach((member) => {
      const memberUser = member.user as JsonRecord | undefined;
      const name = text(
        memberUser?.name,
        text(memberUser?.email, text(memberUser?.phone, "组织成员")),
      );
      const userId = text(memberUser?.id, text(member.user_id, ""));
      if (userId) actors.set(userId, name);
      addResource(["member", "workspace_member"], member.id, name);
    });
    addResource(["workspace"], currentId, current?.name ?? "当前组织");
    (projects.data?.items ?? []).forEach((item) =>
      addResource(["project"], item.id, item.name),
    );
    (sites.data?.items ?? []).forEach((item) =>
      addResource(["site"], item.id, item.name),
    );
    (devices.data?.items ?? []).forEach((item) =>
      addResource(["device"], item.id, `${item.name} · SN ${item.serial_no}`),
    );
    (datasets.data?.items ?? []).forEach((item) =>
      addResource(["dataset"], item.id, item.name),
    );
    (exports.data?.items ?? []).forEach((item) =>
      addResource(
        ["export", "export_job"],
        item.id,
        `导出任务 · ${item.export_type}`,
      ),
    );
    (grants.data?.items ?? []).forEach((item) => {
      const subject = item.subject as JsonRecord | undefined;
      addResource(
        ["access_grant", "grant"],
        item.id,
        `授权给 ${text(subject?.name, text(subject?.email, text(subject?.phone)))}`,
      );
    });
    (invitations.data?.items ?? []).forEach((item) =>
      addResource(
        ["invitation"],
        item.id,
        `邀请 · ${text(item.invitee_email, text(item.invitee_phone))}`,
      ),
    );
    return { actors, resources };
  }, [
    current?.name,
    currentId,
    datasets.data,
    devices.data,
    exports.data,
    grants.data,
    invitations.data,
    members.data,
    projects.data,
    sites.data,
    user,
  ]);
  const resolveActor = (record: JsonRecord) =>
    record.actor_type === "system"
      ? "系统"
      : record.actor_type === "anonymous"
        ? "匿名访问者"
        : (names.actors.get(text(record.actor_id, "")) ??
          (record.actor_type === "service_account" ? "服务账号" : "未知用户"));
  const resolveResource = (record: JsonRecord) =>
    names.resources.get(
      `${text(record.resource_type, "unknown")}:${text(record.resource_id, "")}`,
    ) ?? resourceTypeLabel(text(record.resource_type));
  return (
    <Panel data-onboarding="organization-audit">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">审计事件</h2>

        </div>
        <label className="compact-control">
          返回数量{" "}
          <Input
            type="number"
            min="1"
            max="500"
            value={limit}
            onChange={(event) =>
              setLimit(
                Math.min(500, Math.max(1, Number(event.target.value) || 1)),
              )
            }
          />
        </label>
      </div>
      <RecordTable
        records={query.data?.items}
        loading={query.isLoading}
        error={query.error}
        resolveActor={resolveActor}
        resolveResource={resolveResource}
        columns={[
          "created_at",
          "actor",
          "action",
          "resource",
          "result",
          "ip",
          "request_id",
          "reason",
        ]}
      />
    </Panel>
  );
}

const columnLabels: Record<string, string> = {
  created_at: "时间",
  actor: "操作者",
  action: "动作",
  resource: "资源",
  result: "结果",
  ip: "IP",
  request_id: "Request ID",
  reason: "原因",
};
function RecordTable({
  records = [],
  loading,
  error,
  columns,
  resolveActor,
  resolveResource,
}: {
  records?: JsonRecord[];
  loading?: boolean;
  error?: unknown;
  columns: string[];
  resolveActor: (record: JsonRecord) => string;
  resolveResource: (record: JsonRecord) => string;
}) {
  if (loading)
    return (
      <StateView
        type="loading"
        title="正在加载"
        description="正在读取服务端数据。"
      />
    );
  if (error)
    return (
      <StateView
        type="error"
        title="加载失败"
        description={formatApiError(error).message}
        requestId={formatApiError(error).requestId}
      />
    );
  if (!records.length)
    return (
      <StateView
        type="empty"
        title="暂无记录"
        description="服务端当前没有返回可见记录。"
      />
    );
  return (
    <div className="table-wrap mobile-data-list">
      <Table className="data-table mobile-summary-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>
                {columnLabels[column] ?? column.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={text(record.id, String(index))}>
              {columns.map((column) => (
                <td key={column} data-label={columnLabels[column] ?? column} className={column === "action" ? "mobile-cell-title" : column === "result" ? "mobile-cell-status" : "mobile-cell-wide"}>
                  {column === "actor" ? (
                    <NamedAuditValue
                      name={resolveActor(record)}
                      type={actorTypeLabel(text(record.actor_type))}
                      id={record.actor_id}
                    />
                  ) : column === "resource" ? (
                    <NamedAuditValue
                      name={resolveResource(record)}
                      type={resourceTypeLabel(text(record.resource_type))}
                      id={record.resource_id}
                    />
                  ) : column === "status" || column === "result" ? (
                    <Badge
                      tone={
                        record[column] === "active" ||
                        record[column] === "success"
                          ? "success"
                          : record[column] === "failed"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {text(record[column])}
                    </Badge>
                  ) : column === "created_at" ? (
                    formatAuditTime(record[column])
                  ) : (
                    <span
                      className={
                        column.endsWith("_id") || column === "request_id"
                          ? "mono"
                          : ""
                      }
                    >
                      {text(record[column])}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
function NamedAuditValue({
  name,
  type,
  id,
}: {
  name: string;
  type: string;
  id: unknown;
}) {
  const value = text(id, "");
  return (
    <div>
      <div className="cell-title">{name}</div>
      <div className="cell-sub">
        {type}
        {value ? (
          <>
            {" "}
            · <span className="mono">{value.slice(0, 8)}…</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
const resourceTypeLabel = (type: string) =>
  ({
    workspace: "组织",
    project: "项目",
    site: "站点",
    device: "设备",
    dataset: "Dataset",
    export: "导出任务",
    export_job: "导出任务",
    member: "成员",
    workspace_member: "成员",
    access_grant: "访问授权",
    grant: "访问授权",
    invitation: "邀请",
    auth: "认证",
    media: "媒体",
  })[type] ?? type;
const actorTypeLabel = (type: string) =>
  ({
    user: "用户",
    service_account: "服务账号",
    system: "系统",
    anonymous: "匿名访问",
  })[type] ?? type;
const formatAuditTime = (value: unknown) =>
  value
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(String(value)))
    : "—";
