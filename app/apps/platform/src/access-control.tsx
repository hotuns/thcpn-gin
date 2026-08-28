import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  api,
  commonStatusLabel,
  formatApiError,
  roleTemplateLabel,
  type JsonRecord,
} from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, CopyId, Panel, StateView } from "@thcpn/ui";

type FormMode = "member" | "edit-member" | "grant" | "invitation";
type Template = { code: string; name: string; permission_codes: string[] };
const text = (input: unknown, fallback: unknown = "—"): string =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const formatTime = (input: unknown) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(input)))
    : "长期有效";
export const externalPermission = (code: string) =>
  !["workspace.", "member.", "audit."].some((prefix) =>
    code.startsWith(prefix),
  );
export const permissionsForTemplate = (
  templates: Template[],
  code: string,
  external: boolean,
) =>
  (templates.find((item) => item.code === code)?.permission_codes ?? []).filter(
    (item) => !external || externalPermission(item),
  );

const scopeTypeLabel = (value: string) =>
  ({
    workspace: "整个组织",
    project: "项目",
    site: "站点",
    device: "设备",
    dataset: "数据集",
  })[value] ?? value;

export function AccessControlTab() {
  const { currentId, current } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [editing, setEditing] = useState<JsonRecord | null>(null);
  const [feedback, setFeedback] = useState("");
  const members = useQuery({
    queryKey: workspaceQueryKey(currentId, "members"),
    queryFn: () => api.members.list(currentId!),
    enabled: Boolean(currentId),
  });
  const grants = useQuery({
    queryKey: workspaceQueryKey(currentId, "access-grants"),
    queryFn: () => api.accessGrants.list(currentId!),
    enabled: Boolean(currentId),
  });
  const myGrants = useQuery({
    queryKey: ["access-grants", "mine"],
    queryFn: api.accessGrants.mine,
  });
  const invitations = useQuery({
    queryKey: workspaceQueryKey(currentId, "invitations"),
    queryFn: () => api.invitations.list(currentId!),
    enabled: Boolean(currentId),
  });
  const mine = useQuery({
    queryKey: ["invitations", "mine"],
    queryFn: api.invitations.mine,
  });
  const catalog = useQuery({
    queryKey: ["permissions", "catalog"],
    queryFn: api.permissions.catalog,
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
  const refresh = async () => {
    await Promise.all([
      members.refetch(),
      grants.refetch(),
      myGrants.refetch(),
      invitations.refetch(),
      mine.refetch(),
    ]);
    await client.invalidateQueries({ queryKey: ["workspaces"] });
  };
  const run = async (action: () => Promise<unknown>, success: string) => {
    setFeedback("");
    try {
      await action();
      setFeedback(success);
      await refresh();
      return true;
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(
        `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
      );
      return false;
    }
  };
  const open = (mode: FormMode, record?: JsonRecord) => {
    setEditing(record ?? null);
    setFormMode(mode);
    setFeedback("");
  };
  useEffect(() => {
    if (!currentId || params.get("action") !== "invite") return;
    open("invitation");
    const next = new URLSearchParams(params);
    next.delete("action");
    setParams(next, { replace: true });
  }, [currentId, params, setParams]);
  if (!currentId)
    return (
      <Panel>
        <StateView
          type="empty"
          title="请选择组织"
          description="请先选择组织，再管理访问权限。"
        />
      </Panel>
    );
  const templates = ((catalog.data as any)?.templates ?? []) as Template[];
  const permissions = ((catalog.data as any)?.permissions ?? []) as Array<{
    code: string;
    name: string;
    group: string;
  }>;
  const resources = {
    workspace: [{ id: currentId, name: current?.name ?? "当前组织" }],
    project: projects.data?.items ?? [],
    site: sites.data?.items ?? [],
    device: devices.data?.items ?? [],
    dataset: datasets.data?.items ?? [],
  };
  const summaryCount = (
    query: typeof members,
    predicate?: (item: JsonRecord) => boolean,
  ) =>
    query.isError
      ? "—"
      : predicate
        ? (query.data?.items ?? []).filter(predicate).length
        : (query.data?.items.length ?? 0);
  return (
    <>
      <Panel className="access-guide" data-onboarding="organization-access">
        <div className="access-guide-heading">
          <div>
            <h2 className="panel-title">先选择访问方式</h2>
            <div className="panel-kicker">三种方式对应三种不同的协作关系</div>
          </div>
          <ShieldCheck size={18} />
        </div>
        <div className="access-guide-grid">
          <div>
            <strong>组织成员</strong>
            <p>对方是长期协作者。加入后按成员角色使用当前组织。</p>
            <span>适合课题组成员、项目负责人</span>
          </div>
          <div>
            <strong>单项授权</strong>
            <p>对方不加入组织，只开放指定项目、站点、设备或数据集。</p>
            <span>适合合作单位、临时查看者</span>
          </div>
          <div>
            <strong>访问邀请</strong>
            <p>对方还没有账号，发送邀请后按指定范围获得访问权限。</p>
            <span>适合首次邀请外部用户</span>
          </div>
        </div>
      </Panel>
      <div className="access-summary">
        <div>
          <strong>{summaryCount(members)}</strong>
          <span>组织成员</span>
        </div>
        <div>
          <strong>
            {summaryCount(
              grants as typeof members,
              (item) => item.status === "active",
            )}
          </strong>
          <span>有效授权</span>
        </div>
        <div>
          <strong>
            {summaryCount(
              invitations as typeof members,
              (item) => item.status === "pending",
            )}
          </strong>
          <span>待接受邀请</span>
        </div>
      </div>
      {feedback && <div className="command-note section-gap">{feedback}</div>}
      <div className="access-layout section-gap">
        <AccessPanel
          title="组织成员"
          subtitle="长期协作关系，按成员角色访问"
          icon={<UserPlus size={16} />}
          action={
            <Button variant="secondary" onClick={() => open("member")}>
              <Plus size={14} />
              添加成员
            </Button>
          }
          query={members}
        >
          <MemberRows
            rows={members.data?.items ?? []}
            resources={resources}
            onEdit={(row) => open("edit-member", row)}
            onRemove={(row) =>
              window.confirm(
                `确认移除 ${text((row.user as JsonRecord)?.name, "该成员")}？`,
              ) &&
              void run(
                () => api.members.remove(currentId, text(row.id)),
                "成员已移除",
              )
            }
          />
        </AccessPanel>
        <AccessPanel
          title="单项授权"
          subtitle="不加入组织，只开放指定资源"
          icon={<ShieldCheck size={16} />}
          action={
            <Button variant="secondary" onClick={() => open("grant")}>
              <Plus size={14} />
              创建授权
            </Button>
          }
          query={grants}
        >
          <GrantRows
            rows={grants.data?.items ?? []}
            resources={resources}
            onRevoke={(row) =>
              window.confirm("确认撤销该资源授权？") &&
              void run(
                () => api.accessGrants.revoke(text(row.id)),
                "授权已撤销",
              )
            }
          />
        </AccessPanel>
        <AccessPanel
          title="待处理邀请"
          subtitle="发给尚未加入平台的用户"
          icon={<KeyRound size={16} />}
          action={
            <Button variant="secondary" onClick={() => open("invitation")}>
              <Plus size={14} />
              创建邀请
            </Button>
          }
          query={invitations}
        >
          <InvitationRows
            rows={invitations.data?.items ?? []}
            resources={resources}
            onRevoke={(row) =>
              window.confirm("确认撤销该邀请？") &&
              void run(() => api.invitations.revoke(text(row.id)), "邀请已撤销")
            }
          />
        </AccessPanel>
        <AccessPanel
          title="我收到的邀请"
          subtitle="与当前账号匹配的待处理邀请"
          icon={<Check size={16} />}
          query={mine}
        >
          <InvitationRows
            mine
            rows={mine.data?.items ?? []}
            resources={resources}
            onAccept={(row) =>
              void run(() => api.invitations.accept(text(row.id)), "邀请已接受")
            }
          />
        </AccessPanel>
      </div>
      <div className="section-gap">
        <AccessPanel
          title="我收到的访问"
          subtitle="其他组织分享给当前账号的资源"
          icon={<ShieldCheck size={16} />}
          query={myGrants}
        >
          <GrantRows rows={myGrants.data?.items ?? []} resources={resources} />
        </AccessPanel>
      </div>
      {formMode && (
        <AccessForm
          key={`${formMode}-${text(editing?.id, "new")}`}
          mode={formMode}
          record={editing}
          workspaceId={currentId}
          templates={templates}
          permissions={permissions}
          resources={resources}
          onClose={() => setFormMode(null)}
          onComplete={async (action, message) => {
            const ok = await run(action, message);
            if (ok) setFormMode(null);
            return ok;
          }}
        />
      )}
    </>
  );
}

function AccessPanel({
  title,
  subtitle,
  icon,
  action,
  query,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  action?: ReactNode;
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
        <div className="header-actions">
          {action}
          {!action && icon}
        </div>
      </div>
      {query.isLoading ? (
        <StateView
          type="loading"
          title="正在加载"
          description="正在读取访问控制记录。"
        />
      ) : query.error ? (
        <StateView
          type="error"
          title="加载失败"
          description={formatApiError(query.error).message}
          requestId={formatApiError(query.error).requestId}
        />
      ) : (
        children
      )}
    </Panel>
  );
}
function EmptyRows() {
  return (
    <StateView
      type="empty"
      title="暂无记录"
      description="服务端当前没有返回记录。"
    />
  );
}
type ResourceMap = Record<string, JsonRecord[]>;
function MemberRows({
  rows,
  resources,
  onEdit,
  onRemove,
}: {
  rows: JsonRecord[];
  resources: ResourceMap;
  onEdit: (row: JsonRecord) => void;
  onRemove: (row: JsonRecord) => void;
}) {
  if (!rows.length) return <EmptyRows />;
  return (
    <div className="series-list">
      {rows.map((row) => {
        const user = row.user as JsonRecord | undefined;
        return (
          <div className="series-row access-row" key={text(row.id)}>
            <div>
              <div className="cell-title">
                {text(user?.name, text(user?.email, text(user?.phone)))}
              </div>
              <div className="cell-sub">
                {roleTemplateLabel(
                  text(row.template_code, ""),
                  text(row.template_name, ""),
                )}{" "}
                · {scopeLabel(row, resources)} ·{" "}
                {Array.isArray(row.permission_codes)
                  ? row.permission_codes.length
                  : 0}{" "}
                项权限
              </div>
              <div className="cell-sub">
                加入于 {formatTime(row.joined_at)} ·{" "}
                <CopyId value={text(row.id)} />
              </div>
            </div>
            <div className="resource-row-actions">
              <Badge tone={row.status === "active" ? "success" : "neutral"}>
                {commonStatusLabel(text(row.status, ""))}
              </Badge>
              <Button variant="secondary" onClick={() => onEdit(row)}>
                编辑
              </Button>
              <Button variant="danger" onClick={() => onRemove(row)}>
                <Trash2 size={13} />
                移除
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function GrantRows({
  rows,
  resources,
  onRevoke,
}: {
  rows: JsonRecord[];
  resources: ResourceMap;
  onRevoke?: (row: JsonRecord) => void;
}) {
  if (!rows.length) return <EmptyRows />;
  return (
    <div className="series-list">
      {rows.map((row) => {
        const subject = row.subject as JsonRecord | undefined;
        return (
          <div className="series-row access-row" key={text(row.id)}>
            <div>
              <div className="cell-title">
                {text(
                  subject?.name,
                  text(
                    subject?.email,
                    text(subject?.phone, text(row.workspace_name, "资源授权")),
                  ),
                )}
              </div>
              <div className="cell-sub">
                {roleTemplateLabel(
                  text(row.template_code, ""),
                  text(row.template_name, ""),
                )}{" "}
                · {scopeLabel(row, resources)} ·{" "}
                {Array.isArray(row.permission_codes)
                  ? row.permission_codes.length
                  : 0}{" "}
                项权限
              </div>
              <div className="cell-sub">
                有效期至 {formatTime(row.expires_at)} ·{" "}
                <CopyId value={text(row.id)} />
              </div>
            </div>
            <div className="resource-row-actions">
              <Badge tone={row.status === "active" ? "success" : "neutral"}>
                {commonStatusLabel(text(row.status, ""))}
              </Badge>
              {row.allow_api_access ? <Badge tone="info">API</Badge> : null}
              {row.allow_reshare ? <Badge tone="info">可分享</Badge> : null}
              {row.scope_type === "device" && row.status === "active" ? (
                <Link to={`/devices/${encodeURIComponent(text(row.scope_id))}`}>
                  <Button variant="secondary">打开设备</Button>
                </Link>
              ) : null}
              {onRevoke && row.status === "active" && (
                <Button variant="danger" onClick={() => onRevoke(row)}>
                  撤销
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function InvitationRows({
  rows,
  resources,
  mine,
  onAccept,
  onRevoke,
}: {
  rows: JsonRecord[];
  resources: ResourceMap;
  mine?: boolean;
  onAccept?: (row: JsonRecord) => void;
  onRevoke?: (row: JsonRecord) => void;
}) {
  if (!rows.length) return <EmptyRows />;
  return (
    <div className="series-list">
      {rows.map((row) => (
        <div className="series-row access-row" key={text(row.id)}>
          <div>
            <div className="cell-title">
              {text(row.invitee_email, row.invitee_phone)}
            </div>
            <div className="cell-sub">
              {roleTemplateLabel(
                text(row.template_code, ""),
                text(row.template_name, ""),
              )}{" "}
              · {scopeLabel(row, resources)} ·{" "}
              {Array.isArray(row.permission_codes)
                ? row.permission_codes.length
                : 0}{" "}
              项权限
            </div>
            <div className="cell-sub">
              有效期至 {formatTime(row.expires_at)} ·{" "}
              <CopyId value={text(row.id)} />
            </div>
          </div>
          <div className="resource-row-actions">
            <Badge tone={row.status === "pending" ? "warning" : "neutral"}>
              {commonStatusLabel(text(row.status, ""))}
            </Badge>
            {mine && row.status === "pending" && (
              <Button onClick={() => onAccept?.(row)}>接受</Button>
            )}
            {!mine && row.status === "pending" && (
              <Button variant="danger" onClick={() => onRevoke?.(row)}>
                撤销
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
const scopeLabel = (row: JsonRecord, resources: ResourceMap) => {
  const type = text(row.scope_type);
  const id = text(row.scope_id);
  const resource = (resources[type] ?? []).find((item) => text(item.id) === id);
  return `${scopeTypeLabel(type)} · ${text(resource?.name, text(resource?.serial_no, id.slice(0, 8)))}`;
};

function AccessForm({
  mode,
  record,
  workspaceId,
  templates,
  permissions,
  resources,
  onClose,
  onComplete,
}: {
  mode: FormMode;
  record: JsonRecord | null;
  workspaceId: string;
  templates: Template[];
  permissions: Array<{ code: string; name: string; group: string }>;
  resources: Record<string, JsonRecord[]>;
  onClose: () => void;
  onComplete: (
    action: () => Promise<unknown>,
    message: string,
  ) => Promise<boolean>;
}) {
  const external = mode === "grant" || mode === "invitation";
  const [identityType, setIdentityType] = useState(
    mode === "invitation" ? "email" : "email",
  );
  const [identity, setIdentity] = useState("");
  const [template, setTemplate] = useState(
    text(record?.template_code, external ? "viewer" : "viewer"),
  );
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(
    () =>
      (record?.permission_codes as string[]) ??
      permissionsForTemplate(
        templates,
        external ? "viewer" : "viewer",
        external,
      ),
  );
  const [scopeType, setScopeType] = useState(
    text(record?.scope_type, "workspace"),
  );
  const [scopeId, setScopeId] = useState(text(record?.scope_id, workspaceId));
  const [expiresAt, setExpiresAt] = useState("");
  const [allowReshare, setAllowReshare] = useState(false);
  const [allowApi, setAllowApi] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, onClose]);
  const internalTemplateCodes = [
    "custom",
    "owner",
    "admin",
    "project_manager",
    "site_operator",
    "data_manager",
    "researcher",
    "viewer",
  ];
  const externalTemplateCodes = [
    "custom",
    "shared_viewer",
    "shared_downloader",
    "project_manager",
    "site_operator",
    "data_manager",
    "researcher",
    "viewer",
    "service_engineer",
  ];
  const availableTemplates = templates.filter((item) =>
    (external ? externalTemplateCodes : internalTemplateCodes).includes(
      item.code,
    ),
  );
  const availablePermissions = permissions.filter(
    (item) => !external || externalPermission(item.code),
  );
  const setTemplateCode = (code: string) => {
    setTemplate(code);
    setSelectedPermissions(permissionsForTemplate(templates, code, external));
    if (code === "owner") {
      setScopeType("workspace");
      setScopeId(workspaceId);
    }
    if (
      code === "service_engineer" &&
      !["site", "device"].includes(scopeType)
    ) {
      setScopeType("device");
      setScopeId("");
    }
  };
  const changeScope = (next: string) => {
    setScopeType(next);
    setScopeId(next === "workspace" ? workspaceId : "");
  };
  const togglePermission = (code: string) =>
    setSelectedPermissions((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code],
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPermissions.length || !scopeId) return;
    setBusy(true);
    const common: JsonRecord = {
      template_code: template,
      permission_codes: selectedPermissions,
      scope_type: scopeType,
      scope_id: scopeId,
    };
    if (expiresAt) common.expires_at = new Date(expiresAt).toISOString();
    try {
      if (mode === "edit-member")
        await onComplete(
          () => api.members.update(workspaceId, text(record?.id), common),
          "成员权限已更新",
        );
      else if (mode === "member")
        await onComplete(
          () =>
            api.members.add(workspaceId, {
              ...common,
              [identityType]: identity.trim(),
            }),
          "成员已添加",
        );
      else if (mode === "grant")
        await onComplete(
          () =>
            api.accessGrants.create({
              ...common,
              [identityType === "user_id" ? "subject_user_id" : identityType]:
                identity.trim(),
              allow_reshare: allowReshare,
              allow_api_access: allowApi,
            }),
          "资源授权已创建",
        );
      else
        await onComplete(
          () =>
            api.invitations.create({
              ...common,
              [identityType]: identity.trim(),
            }),
          "邀请已发送",
        );
    } finally {
      setBusy(false);
    }
  };
  const serviceInvalid =
    template === "service_engineer" &&
    (!expiresAt || !["site", "device"].includes(scopeType));
  return (
    <div className="access-drawer-layer">
      <button
        type="button"
        className="access-drawer-backdrop"
        aria-label="关闭权限编辑"
        onClick={() => !busy && onClose()}
      />
      <div
        className="access-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-editor-title"
      >
        <Panel className="access-editor-panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title" id="access-editor-title">
                {mode === "member"
                  ? "添加内部成员"
                  : mode === "edit-member"
                    ? "编辑成员权限"
                    : mode === "grant"
                      ? "创建资源授权"
                      : "创建邀请"}
              </h2>
              <div className="panel-kicker">
                {mode === "member" || mode === "edit-member"
                  ? "选择成员角色；默认作用于整个组织"
                  : mode === "grant"
                    ? "选择资源范围，只开放需要的权限"
                    : "对方接受后获得指定范围的访问权限"}
              </div>
            </div>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              <X size={14} />
              关闭
            </Button>
          </div>
          <form onSubmit={submit} className="access-form">
            {mode !== "edit-member" && (
              <div className="form-section">
                <h3>授权对象</h3>
                <div className="access-form-grid">
                  <label className="field">
                    <span className="field-label">识别方式</span>
                    <select
                      value={identityType}
                      onChange={(event) => setIdentityType(event.target.value)}
                    >
                      {mode !== "invitation" && (
                        <option value="user_id">用户 ID</option>
                      )}
                      <option value="email">邮箱</option>
                      <option value="phone">手机号</option>
                    </select>
                  </label>
                  <label className="field field-wide">
                    <span className="field-label">
                      {identityType === "email"
                        ? "邮箱"
                        : identityType === "phone"
                          ? "手机号"
                          : "用户 ID"}
                    </span>
                    <input
                      required
                      value={identity}
                      onChange={(event) => setIdentity(event.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}
            <div className="form-section">
              <h3>访问范围与角色</h3>
              <div className="access-form-grid">
                <label className="field">
                  <span className="field-label">
                    {external ? "访问角色" : "成员角色"}
                  </span>
                  <select
                    value={template}
                    onChange={(event) => setTemplateCode(event.target.value)}
                  >
                    {availableTemplates.map((item) => (
                      <option key={item.code} value={item.code}>
                        {roleTemplateLabel(item.code, item.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">访问范围</span>
                  <select
                    value={scopeType}
                    disabled={template === "owner"}
                    onChange={(event) => changeScope(event.target.value)}
                  >
                    {["workspace", "project", "site", "device", "dataset"]
                      .filter(
                        (item) =>
                          template !== "service_engineer" ||
                          ["site", "device"].includes(item),
                      )
                      .map((item) => (
                        <option key={item} value={item}>
                          {scopeTypeLabel(item)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field field-wide">
                  <span className="field-label">具体资源</span>
                  <select
                    required
                    value={scopeId}
                    disabled={scopeType === "workspace"}
                    onChange={(event) => setScopeId(event.target.value)}
                  >
                    <option value="">选择资源</option>
                    {(resources[scopeType] ?? []).map((item) => (
                      <option key={text(item.id)} value={text(item.id)}>
                        {text(item.name, text(item.serial_no, item.id))}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <details className="form-section access-advanced">
              <summary>
                <span>高级：调整具体操作权限</span>
                <strong>{selectedPermissions.length} 项已选择</strong>
              </summary>
              <div className="permission-grid">
                {availablePermissions.map((item) => (
                  <label
                    key={item.code}
                    className={
                      selectedPermissions.includes(item.code) ? "selected" : ""
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(item.code)}
                      onChange={() => togglePermission(item.code)}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.code}</small>
                    </span>
                  </label>
                ))}
              </div>
            </details>
            {external && (
              <div className="form-section">
                <h3>有效期与附加能力</h3>
                <div className="access-form-grid">
                  <label className="field">
                    <span className="field-label">
                      过期时间
                      {template === "service_engineer" ? "（必填）" : ""}
                    </span>
                    <input
                      type="datetime-local"
                      required={template === "service_engineer"}
                      value={expiresAt}
                      onChange={(event) => setExpiresAt(event.target.value)}
                    />
                  </label>
                  {mode === "grant" && (
                    <div className="access-toggles">
                      <label>
                        <input
                          type="checkbox"
                          checked={allowReshare}
                          onChange={(event) =>
                            setAllowReshare(event.target.checked)
                          }
                        />
                        允许再次分享
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={allowApi}
                          onChange={(event) =>
                            setAllowApi(event.target.checked)
                          }
                        />
                        允许 API 访问
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="form-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !selectedPermissions.length ||
                  !scopeId ||
                  (mode !== "edit-member" && !identity.trim()) ||
                  serviceInvalid
                }
              >
                {busy ? "提交中…" : "确认提交"}
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
