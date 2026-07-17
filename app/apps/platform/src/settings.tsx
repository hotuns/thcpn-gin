import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Pencil, Plus, X } from "lucide-react";
import { api, formatApiError, type JsonRecord } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";
import { AccessControlTab } from "./access-control";
import { SecurityTab as StructuredSecurityTab } from "./security-tab";

const text = (value: unknown, fallback = "—") =>
  value === undefined || value === null || value === ""
    ? fallback
    : String(value);
export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "resources";
  const tabs = [
    { id: "resources", label: "基础资料" },
    { id: "access", label: "访问控制" },
    { id: "audit", label: "审计日志" },
    { id: "security", label: "账号安全" },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Workspace / settings"
        title="设置"
        description="管理 Workspace 基础资料、协作关系、审计和当前账号安全。"
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
      ) : tab === "audit" ? (
        <AuditTab />
      ) : (
        <StructuredSecurityTab />
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
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteLocation, setSiteLocation] = useState("");
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<{
    kind: "Project" | "Site";
    record: JsonRecord;
  } | null>(null);
  const [message, setMessage] = useState("");
  const showError = (error: unknown) => {
    const item = formatApiError(error);
    setMessage(
      `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
    );
  };
  const createProject = async () => {
    if (!currentId || !projectName.trim()) return;
    try {
      await api.projects.create({
        workspace_id: currentId,
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
      });
      setProjectName("");
      setProjectDescription("");
      setMessage("Project 已创建");
      await client.invalidateQueries({
        queryKey: workspaceQueryKey(currentId, "projects"),
      });
    } catch (error) {
      showError(error);
    }
  };
  const createSite = async () => {
    if (!currentId || !projectId || !siteName.trim()) return;
    try {
      await api.sites.create({
        workspace_id: currentId,
        project_id: projectId,
        name: siteName.trim(),
        location_text: siteLocation.trim() || undefined,
      });
      setSiteName("");
      setSiteLocation("");
      setMessage("Site 已创建");
      await client.invalidateQueries({
        queryKey: workspaceQueryKey(currentId, "sites"),
      });
    } catch (error) {
      showError(error);
    }
  };
  const updateResource = async (payload: JsonRecord) => {
    if (!editing) return;
    try {
      if (editing.kind === "Project")
        await api.projects.update(text(editing.record.id), payload);
      else await api.sites.update(text(editing.record.id), payload);
      setMessage(`${editing.kind} 已更新`);
      setEditing(null);
      await client.invalidateQueries({
        queryKey: workspaceQueryKey(
          currentId,
          editing.kind === "Project" ? "projects" : "sites",
        ),
      });
    } catch (error) {
      showError(error);
    }
  };
  if (!currentId)
    return (
      <Panel>
        <StateView
          type="empty"
          title="请选择 Workspace"
          description="基础资料依赖 Workspace 上下文。"
        />
      </Panel>
    );
  return (
    <>
      <div className="grid grid-2">
        <Panel>
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Project</h2>
              <div className="panel-kicker">Workspace 下的研究项目</div>
            </div>
            <Badge tone="info">{projects.data?.items.length ?? 0}</Badge>
          </div>
          <div className="resource-create">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project 名称"
            />
            <input
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              placeholder="描述（可选）"
            />
            <Button
              disabled={!projectName.trim()}
              onClick={() => void createProject()}
            >
              <Plus size={14} />
              创建
            </Button>
          </div>
          <ResourceRows
            query={projects}
            kind="Project"
            onEdit={(record) => setEditing({ kind: "Project", record })}
          />
        </Panel>
        <Panel>
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Site</h2>
              <div className="panel-kicker">Project 下的现场站点</div>
            </div>
            <Badge tone="info">{sites.data?.items.length ?? 0}</Badge>
          </div>
          <div className="resource-create resource-create-site">
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">选择 Project</option>
              {projects.data?.items.map((item) => (
                <option key={text(item.id)} value={text(item.id)}>
                  {text(item.name)}
                </option>
              ))}
            </select>
            <input
              value={siteName}
              onChange={(event) => setSiteName(event.target.value)}
              placeholder="Site 名称"
            />
            <input
              value={siteLocation}
              onChange={(event) => setSiteLocation(event.target.value)}
              placeholder="位置（可选）"
            />
            <Button
              disabled={!projectId || !siteName.trim()}
              onClick={() => void createSite()}
            >
              <Plus size={14} />
              创建
            </Button>
          </div>
          <ResourceRows
            query={sites}
            kind="Site"
            onEdit={(record) => setEditing({ kind: "Site", record })}
          />
        </Panel>
      </div>
      {editing && (
        <ResourceEditor
          key={text(editing.record.id)}
          editing={editing}
          projects={projects.data?.items ?? []}
          onClose={() => setEditing(null)}
          onSave={updateResource}
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
  kind: string;
  onEdit: (record: JsonRecord) => void;
}) {
  if (query.isLoading)
    return (
      <StateView
        type="loading"
        title={`正在加载 ${kind}`}
        description="正在读取基础资料。"
      />
    );
  if (query.error)
    return (
      <StateView
        type="error"
        title={`${kind} 加载失败`}
        description={formatApiError(query.error).message}
      />
    );
  if (!query.data?.items.length)
    return (
      <StateView
        type="empty"
        title={`暂无 ${kind}`}
        description={`创建第一个 ${kind} 后会显示在这里。`}
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

function ResourceEditor({
  editing,
  projects,
  onClose,
  onSave,
}: {
  editing: { kind: "Project" | "Site"; record: JsonRecord };
  projects: JsonRecord[];
  onClose: () => void;
  onSave: (payload: JsonRecord) => Promise<void>;
}) {
  const [name, setName] = useState(text(editing.record.name, ""));
  const [description, setDescription] = useState(
    text(editing.record.description, ""),
  );
  const [location, setLocation] = useState(
    text(editing.record.location_text, ""),
  );
  const [status, setStatus] = useState(text(editing.record.status, "active"));
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(
        editing.kind === "Project"
          ? { name: name.trim(), description: description.trim(), status }
          : { name: name.trim(), location_text: location.trim(), status },
      );
    } finally {
      setBusy(false);
    }
  };
  const projectName = text(
    projects.find((item) => text(item.id) === text(editing.record.project_id))
      ?.name,
    text(editing.record.project_id),
  );
  return (
    <Panel className="section-gap resource-editor">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">编辑 {editing.kind}</h2>
          <div className="panel-kicker mono">{text(editing.record.id)}</div>
        </div>
        <Button variant="secondary" onClick={onClose}>
          <X size={14} />
          关闭
        </Button>
      </div>
      <form className="resource-editor-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">名称</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {editing.kind === "Project" ? (
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
              <span className="field-label">所属 Project</span>
              <input value={projectName} disabled />
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
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "保存中…" : "保存更改"}
        </Button>
      </form>
    </Panel>
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
        text(memberUser?.email, text(memberUser?.phone, "Workspace 成员")),
      );
      const userId = text(memberUser?.id, text(member.user_id, ""));
      if (userId) actors.set(userId, name);
      addResource(["member", "workspace_member"], member.id, name);
    });
    addResource(["workspace"], currentId, current?.name ?? "当前 Workspace");
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
    workspace: "Workspace",
    project: "Project",
    site: "Site",
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
