import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Send, Trash2, X } from "lucide-react";
import {
  api,
  commonStatusLabel,
  formatApiError,
  roleTemplateLabel,
  type Device,
  type JsonRecord,
} from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, CopyId, Panel, StateView } from "@thcpn/ui";
import { externalPermission, permissionsForTemplate } from "./access-control";
import { DevicePublicAccessPanel } from "./device-public-access";

type Template = { code: string; name: string; permission_codes: string[] };
const text = (input: unknown, fallback: unknown = "—") =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const formatTime = (input: unknown) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(input)))
    : "长期有效";
const deviceSharePermission = (code: string) =>
  ["device.", "media.", "telemetry.", "share.", "service_access."].some(
    (prefix) => code.startsWith(prefix),
  );
const templateDevicePermissions = (templates: Template[], code: string) =>
  permissionsForTemplate(templates, code, true).filter(deviceSharePermission);

export function DeviceSharingTab({ workspaceId, device }: { workspaceId: string; device: Device }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<"grant" | "invitation" | null>(null);
  const [feedback, setFeedback] = useState("");
  const scope = useMemo(() => ({ type: "device", id: device.id }), [device.id]);
  const grantsKey = workspaceQueryKey(workspaceId, "device", device.id, "access-grants");
  const invitationsKey = workspaceQueryKey(workspaceId, "device", device.id, "invitations");
  const grants = useQuery({ queryKey: grantsKey, queryFn: () => api.accessGrants.list(workspaceId, scope), retry: false });
  const invitations = useQuery({ queryKey: invitationsKey, queryFn: () => api.invitations.list(workspaceId, scope), retry: false });
  const mine = useQuery({ queryKey: ["access-grants", "mine"], queryFn: api.accessGrants.mine });
  const catalog = useQuery({ queryKey: ["permissions", "catalog"], queryFn: api.permissions.catalog });
  const directMine = (mine.data?.items ?? []).filter((item) => item.scope_type === "device" && item.scope_id === device.id);
  const forbidden = formatApiError(grants.error).status === 403;
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: grantsKey }),
      client.invalidateQueries({ queryKey: invitationsKey }),
      client.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "access-grants") }),
      client.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId, "invitations") }),
      client.invalidateQueries({ queryKey: ["access-grants", "mine"] }),
    ]);
  };
  const run = async (action: () => Promise<unknown>, message: string) => {
    setFeedback("");
    try {
      await action();
      setFeedback(message);
      await refresh();
      return true;
    } catch (error) {
      const item = formatApiError(error);
      setFeedback(`${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`);
      return false;
    }
  };
  return (
    <>
      <DevicePublicAccessPanel device={device} />
      <div className="device-sharing-note">
        <KeyRound size={16} />
        <span>这里只管理直接授予当前设备的访问权限。组织、项目、站点继承权限请在全局访问控制中管理。</span>
        <Link to="/settings?tab=access"><Button variant="secondary">全局访问控制</Button></Link>
      </div>
      {feedback && <div className="command-note device-feedback">{feedback}</div>}
      {forbidden ? (
        <Panel>
          {directMine.length ? (
            <>
              <div className="panel-header compact-panel-header"><div><h2 className="panel-title">我的设备授权</h2><div className="panel-kicker">当前账号只能查看自己的授权信息</div></div></div>
              <ShareRows rows={directMine} />
            </>
          ) : (
            <StateView type="error" title="无权查看共享记录" description="你可以访问设备，但不能查看其他接收人的共享信息。" />
          )}
        </Panel>
      ) : grants.isLoading || invitations.isLoading ? (
        <Panel><StateView type="loading" title="正在加载设备分享" description="正在读取直接授权与邀请。" /></Panel>
      ) : grants.error || invitations.error ? (
        <Panel><StateView type="error" title="设备分享加载失败" description={formatApiError(grants.error || invitations.error).message} requestId={formatApiError(grants.error || invitations.error).requestId} /></Panel>
      ) : (
        <div className="device-sharing-grid">
          <Panel>
            <div className="panel-header compact-panel-header">
              <div><h2 className="panel-title">直接授权</h2><div className="panel-kicker">已注册用户的设备级访问</div></div>
              <Button onClick={() => setMode("grant")}><Plus size={14} />创建授权</Button>
            </div>
            <ShareRows
              rows={grants.data?.items ?? []}
              onRevoke={(row) => window.confirm("确认撤销这条设备授权？") && void run(() => api.accessGrants.revoke(text(row.id)), "设备授权已撤销")}
            />
          </Panel>
          <Panel>
            <div className="panel-header compact-panel-header">
              <div><h2 className="panel-title">待接受邀请</h2><div className="panel-kicker">通过邮箱或手机号邀请</div></div>
              <Button variant="secondary" onClick={() => setMode("invitation")}><Send size={14} />发送邀请</Button>
            </div>
            <InvitationRows
              rows={invitations.data?.items ?? []}
              onRevoke={(row) => window.confirm("确认撤销这条设备邀请？") && void run(() => api.invitations.revoke(text(row.id)), "设备邀请已撤销")}
            />
          </Panel>
        </div>
      )}
      {mode && catalog.data && (
        <DeviceShareEditor
          mode={mode}
          device={device}
          templates={((catalog.data as JsonRecord).templates ?? []) as Template[]}
          permissions={((catalog.data as JsonRecord).permissions ?? []) as Array<{ code: string; name: string }>}
          onClose={() => setMode(null)}
          onComplete={async (action, message) => {
            const success = await run(action, message);
            if (success) setMode(null);
          }}
        />
      )}
    </>
  );
}

function ShareRows({ rows, onRevoke }: { rows: JsonRecord[]; onRevoke?: (row: JsonRecord) => void }) {
  if (!rows.length) return <StateView type="empty" title="暂无直接授权" description="当前设备还没有单独分享给其他用户。" />;
  return <div className="series-list">{rows.map((row) => {
    const subject = row.subject as JsonRecord | undefined;
    return <div className="series-row access-row" key={text(row.id)}>
      <div><div className="cell-title">{text(subject?.name, text(subject?.email, text(subject?.phone, "设备授权")))}</div><div className="cell-sub">{roleTemplateLabel(text(row.template_code, ""), text(row.template_name, ""))} · {Array.isArray(row.permission_codes) ? row.permission_codes.length : 0} 项权限</div><div className="cell-sub">有效期至 {formatTime(row.expires_at)} · <CopyId value={text(row.id)} /></div></div>
      <div className="resource-row-actions"><Badge tone={row.status === "active" ? "success" : "neutral"}>{commonStatusLabel(text(row.status, ""))}</Badge>{row.allow_reshare ? <Badge tone="info">可再次分享</Badge> : null}{row.allow_api_access ? <Badge tone="info">API</Badge> : null}{onRevoke && row.status === "active" ? <Button variant="danger" onClick={() => onRevoke(row)}><Trash2 size={13} />撤销</Button> : null}</div>
    </div>;
  })}</div>;
}

function InvitationRows({ rows, onRevoke }: { rows: JsonRecord[]; onRevoke: (row: JsonRecord) => void }) {
  if (!rows.length) return <StateView type="empty" title="暂无待接受邀请" description="当前设备没有等待接受的邀请。" />;
  return <div className="series-list">{rows.map((row) => <div className="series-row access-row" key={text(row.id)}><div><div className="cell-title">{text(row.invitee_email, row.invitee_phone)}</div><div className="cell-sub">{roleTemplateLabel(text(row.template_code, ""), text(row.template_name, ""))} · {Array.isArray(row.permission_codes) ? row.permission_codes.length : 0} 项权限</div><div className="cell-sub">有效期至 {formatTime(row.expires_at)}</div></div><div className="resource-row-actions"><Badge tone={row.status === "pending" ? "warning" : "neutral"}>{commonStatusLabel(text(row.status, ""))}</Badge>{row.status === "pending" && <Button variant="danger" onClick={() => onRevoke(row)}>撤销</Button>}</div></div>)}</div>;
}

function DeviceShareEditor({ mode, device, templates, permissions, onClose, onComplete }: {
  mode: "grant" | "invitation";
  device: Device;
  templates: Template[];
  permissions: Array<{ code: string; name: string }>;
  onClose: () => void;
  onComplete: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const externalTemplates = templates.filter((item) => !["owner", "admin"].includes(item.code));
  const [identityType, setIdentityType] = useState(mode === "grant" ? "email" : "email");
  const [identity, setIdentity] = useState("");
  const [template, setTemplate] = useState("viewer");
  const [selected, setSelected] = useState(() => templateDevicePermissions(templates, "viewer"));
  const [expiresAt, setExpiresAt] = useState("");
  const [allowReshare, setAllowReshare] = useState(false);
  const [allowApi, setAllowApi] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, []);
  const availablePermissions = permissions.filter(
    (item) => externalPermission(item.code) && deviceSharePermission(item.code),
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!identity.trim() || !selected.length) return;
    setBusy(true);
    const payload: JsonRecord = { template_code: template, permission_codes: selected, scope_type: "device", scope_id: device.id, [identityType === "user_id" ? "subject_user_id" : identityType]: identity.trim() };
    if (expiresAt) payload.expires_at = new Date(expiresAt).toISOString();
    try {
      await onComplete(
        mode === "grant" ? () => api.accessGrants.create({ ...payload, allow_reshare: allowReshare, allow_api_access: allowApi }) : () => api.invitations.create(payload),
        mode === "grant" ? "设备授权已创建" : "设备邀请已发送",
      );
    } finally { setBusy(false); }
  };
  return (
    <div className="access-drawer-layer">
      <button
        className="access-drawer-backdrop"
        aria-label="关闭设备分享编辑"
        onClick={onClose}
      />
      <div className="access-editor" role="dialog" aria-modal="true">
        <Panel className="access-editor-panel">
          <div className="panel-header">
            <h2 className="panel-title">
              {mode === "grant" ? "创建设备授权" : "发送设备邀请"}
            </h2>
            <Button variant="secondary" onClick={onClose}>
              <X size={14} />关闭
            </Button>
          </div>
          <form className="access-form" onSubmit={submit}>
            <div className="form-section">
              <div className="access-form-grid device-share-fields">
                <label className="field">
                  <span className="field-label">识别方式</span>
                  <select
                    value={identityType}
                    onChange={(event) => setIdentityType(event.target.value)}
                  >
                    {mode === "grant" && <option value="user_id">用户 ID</option>}
                    <option value="email">邮箱</option>
                    <option value="phone">手机号</option>
                  </select>
                </label>
                <label className="field field-wide">
                  <span className="field-label">接收人</span>
                  <input
                    required
                    value={identity}
                    onChange={(event) => setIdentity(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">权限模板</span>
                  <select
                    value={template}
                    onChange={(event) => {
                      setTemplate(event.target.value);
                      setSelected(templateDevicePermissions(templates, event.target.value));
                    }}
                  >
                    {externalTemplates.map((item) => (
                      <option key={item.code} value={item.code}>
                        {roleTemplateLabel(item.code, item.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">过期时间</span>
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="form-section">
              <h3>权限点 <span>{selected.length} 项</span></h3>
              <div className="permission-grid">
                {availablePermissions.map((item) => (
                  <label
                    key={item.code}
                    className={selected.includes(item.code) ? "selected" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(item.code)}
                      onChange={() => setSelected((current) =>
                        current.includes(item.code)
                          ? current.filter((code) => code !== item.code)
                          : [...current, item.code],
                      )}
                    />
                    <span><strong>{item.name}</strong><small>{item.code}</small></span>
                  </label>
                ))}
              </div>
            </div>
            {mode === "grant" && (
              <div className="form-section access-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={allowReshare}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setAllowReshare(checked);
                      if (checked) {
                        setSelected((current) => Array.from(new Set([
                          ...current,
                          "share.view",
                          "share.create",
                          "share.revoke",
                        ])));
                      }
                    }}
                  />
                  允许再次分享
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={allowApi}
                    onChange={(event) => setAllowApi(event.target.checked)}
                  />
                  允许 API 访问
                </label>
              </div>
            )}
            <div className="form-actions">
              <Button variant="secondary" type="button" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={busy || !identity.trim() || !selected.length}>
                {busy ? "提交中…" : "确认提交"}
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
