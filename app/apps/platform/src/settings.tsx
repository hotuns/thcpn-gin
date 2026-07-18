import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";
import { Pencil, Plus, X } from "lucide-react";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";
import { AccessControlTab } from "./access-control";

const text = (value: unknown, fallback = "—") =>
  value === undefined || value === null || value === ""
    ? fallback
    : String(value);
const resourceKindLabel = (kind: "Project" | "Site") =>
  kind === "Project" ? "项目" : "样地";
export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "resources";
  if (tab === "security")
    return <Navigate to="/account?tab=security" replace />;
  const tabs = [
    { id: "resources", label: "基础资料" },
    { id: "access", label: "访问控制" },
    { id: "audit", label: "审计日志" },
  ];
  return (
    <>
      <PageHeader
        eyebrow="工作区 / 设置"
        title="工作区设置"
        description="管理当前工作区的基础资料、协作关系和审计记录。"
      />
      <div className="settings-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setParams({ tab: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "resources" ? (
        <ResourcesTab />
      ) : tab === "access" ? (
        <AccessControlTab />
      ) : (
        <AuditTab />
      )}
    </>
  );
}

function ResourcesTab() {
  const { currentId } = useWorkspace();
  const client = useQueryClient();
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
  const [resourceDialog, setResourceDialog] = useState<{
    kind: "Project" | "Site";
    record?: JsonRecord;
  } | null>(null);
  const [message, setMessage] = useState("");
  const showError = (error: unknown) => {
    const item = formatApiError(error);
    setMessage(
      `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
    );
  };
  const saveResource = async (
    kind: "Project" | "Site",
    record: JsonRecord | undefined,
    payload: JsonRecord,
  ) => {
    if (!currentId) return false;
    try {
      if (kind === "Project") {
        if (record) await api.projects.update(text(record.id), payload);
        else await api.projects.create({ workspace_id: currentId, ...payload });
      } else if (record) await api.sites.update(text(record.id), payload);
      else await api.sites.create({ workspace_id: currentId, ...payload });
      setMessage(`${resourceKindLabel(kind)}${record ? "已更新" : "已创建"}`);
      setResourceDialog(null);
      await client.invalidateQueries({
        queryKey: workspaceQueryKey(
          currentId,
          kind === "Project" ? "projects" : "sites",
        ),
      });
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  };
  if (!currentId)
    return (
      <Panel>
        <StateView
          type="empty"
          title="请选择工作区"
          description="请先选择工作区，再管理基础资料。"
        />
      </Panel>
    );
  return (
    <>
      <div className="grid grid-2">
        <Panel>
          <div className="panel-header">
            <div>
              <h2 className="panel-title">项目</h2>
              <div className="panel-kicker">工作区下的研究项目</div>
            </div>
            <div className="resource-panel-actions">
              <Badge tone="info">{projects.data?.items.length ?? 0}</Badge>
              <Button
                variant="secondary"
                onClick={() =>
                  setResourceDialog({ kind: "Project" })
                }
              >
                <Plus size={14} />
                创建项目
              </Button>
            </div>
          </div>
          <ResourceRows
            query={projects}
            kind="Project"
            onEdit={(record) =>
              setResourceDialog({ kind: "Project", record })
            }
          />
        </Panel>
        <Panel>
          <div className="panel-header">
            <div>
              <h2 className="panel-title">样地</h2>
              <div className="panel-kicker">项目下的现场样地</div>
            </div>
            <div className="resource-panel-actions">
              <Badge tone="info">{sites.data?.items.length ?? 0}</Badge>
              <Button
                variant="secondary"
                onClick={() => setResourceDialog({ kind: "Site" })}
              >
                <Plus size={14} />
                创建样地
              </Button>
            </div>
          </div>
          <ResourceRows
            query={sites}
            kind="Site"
            onEdit={(record) =>
              setResourceDialog({ kind: "Site", record })
            }
          />
        </Panel>
      </div>
      {resourceDialog && (
        <ResourceFormDialog
          key={`${resourceDialog.kind}-${text(resourceDialog.record?.id, "new")}`}
          kind={resourceDialog.kind}
          record={resourceDialog.record}
          projects={projects.data?.items ?? []}
          onClose={() => setResourceDialog(null)}
          onSave={(payload) =>
            saveResource(resourceDialog.kind, resourceDialog.record, payload)
          }
        />
      )}
      {message && <div className="command-note section-gap">{message}</div>}
    </>
  );
}

function ResourceRows({
  query,
  kind,
  onEdit,
}: {
  query: any;
  kind: "Project" | "Site";
  onEdit: (record: JsonRecord) => void;
}) {
  if (query.isLoading)
    return (
      <StateView
        type="loading"
        title={`正在加载${resourceKindLabel(kind)}`}
        description="正在读取基础资料。"
      />
    );
  if (query.error)
    return (
      <StateView
        type="error"
        title={`${resourceKindLabel(kind)}加载失败`}
        description={formatApiError(query.error).message}
      />
    );
  if (!query.data?.items.length)
    return (
      <StateView
        type="empty"
        title={`暂无${resourceKindLabel(kind)}`}
        description={`创建第一个${resourceKindLabel(kind)}后会显示在这里。`}
      />
    );
  return (
    <div className="series-list">
      {query.data.items.map((item: JsonRecord) => (
        <div className="series-row resource-row" key={text(item.id)}>
          <div>
            <div className="cell-title">{text(item.name)}</div>
            <div className="cell-sub">
              {text(item.description, text(item.location_text, "暂无描述"))}
            </div>
            <div className="cell-sub mono">{text(item.id)}</div>
          </div>
          <div className="resource-row-actions">
            <Badge tone={item.status === "active" ? "success" : "neutral"}>
              {text(item.status, "active")}
            </Badge>
            <Button variant="secondary" onClick={() => onEdit(item)}>
              <Pencil size={13} />
              编辑
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResourceFormDialog({
  kind,
  record,
  projects,
  onClose,
  onSave,
}: {
  kind: "Project" | "Site";
  record?: JsonRecord;
  projects: JsonRecord[];
  onClose: () => void;
  onSave: (payload: JsonRecord) => Promise<boolean>;
}) {
  const editing = Boolean(record);
  const [name, setName] = useState(text(record?.name, ""));
  const [description, setDescription] = useState(
    text(record?.description, ""),
  );
  const [location, setLocation] = useState(
    text(record?.location_text, ""),
  );
  const [projectId, setProjectId] = useState(text(record?.project_id, ""));
  const [status, setStatus] = useState(text(record?.status, "active"));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, onClose]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(
        kind === "Project"
          ? { name: name.trim(), description: description.trim(), status }
          : {
              name: name.trim(),
              project_id: projectId,
              location_text: location.trim(),
              status,
            },
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="resource-dialog-layer">
      <button
        type="button"
        className="resource-dialog-backdrop"
        aria-label="关闭资源表单"
        onClick={() => !busy && onClose()}
      />
      <div
        className="resource-dialog-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-dialog-title"
      >
        <Panel className="resource-dialog">
          <div className="panel-header">
          <div>
            <h2 className="panel-title" id="resource-dialog-title">
              {editing ? "编辑" : "创建"}{resourceKindLabel(kind)}
            </h2>
            <div className="panel-kicker">
              {kind === "Project" ? "管理项目名称和描述" : "设置所属项目和样地位置"}
            </div>
          </div>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            <X size={14} />
            关闭
          </Button>
        </div>
        <form className="resource-dialog-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">名称</span>
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {kind === "Project" ? (
          <label className="field">
            <span className="field-label">描述</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="field">
              <span className="field-label">所属项目</span>
              <select
                required
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">选择项目</option>
                {projects.map((item) => (
                  <option key={text(item.id)} value={text(item.id)}>
                    {text(item.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">位置</span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </label>
          </>
        )}
        {editing && (
          <label className="field">
            <span className="field-label">状态</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="active">启用</option>
              <option value="archived">归档</option>
            </select>
          </label>
        )}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || !name.trim() || (kind === "Site" && !projectId)}
            >
              {busy ? "保存中…" : editing ? "保存更改" : "确认创建"}
            </Button>
          </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function AuditTab() {
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
        text(memberUser?.email, text(memberUser?.phone, "工作区成员")),
      );
      const userId = text(memberUser?.id, text(member.user_id, ""));
      if (userId) actors.set(userId, name);
      addResource(["member", "workspace_member"], member.id, name);
    });
    addResource(["workspace"], currentId, current?.name ?? "当前工作区");
    (projects.data?.items ?? []).forEach((item) =>
      addResource(["project"], item.id, item.name),
    );
    (sites.data?.items ?? []).forEach((item) =>
      addResource(["site"], item.id, item.name),
    );
    (devices.data?.items ?? []).forEach((item) =>
      addResource(["device"], item.id, `${item.name} · ${item.serial_no}`),
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
    <Panel>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">审计事件</h2>
          <div className="panel-kicker">敏感操作和访问记录</div>
        </div>
        <label className="compact-control">
          返回数量{" "}
          <input
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
    <div className="table-wrap">
      <table className="data-table">
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
                <td key={column}>
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
      </table>
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
    workspace: "工作区",
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
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(String(value)))
    : "—";
