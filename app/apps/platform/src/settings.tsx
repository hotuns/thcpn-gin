import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, Users } from "lucide-react";
import { api, authStorage, formatApiError, type JsonRecord } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, PageHeader, Panel, StateView } from "@thcpn/ui";

const text = (value: unknown, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const json = (value: unknown) => JSON.stringify(value, null, 2);

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "resources";
  const tabs = [{ id: "resources", label: "基础资料" }, { id: "access", label: "访问控制" }, { id: "audit", label: "审计日志" }, { id: "security", label: "账号安全" }];
  return <><PageHeader eyebrow="Workspace / settings" title="设置" description="管理 Workspace 基础资料、协作关系、审计和当前账号安全。" /><div className="settings-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setParams({ tab: item.id })}>{item.label}</button>)}</div>{tab === "resources" ? <ResourcesTab /> : tab === "access" ? <AccessTab /> : tab === "audit" ? <AuditTab /> : <SecurityTab />}</>;
}

function ResourcesTab() {
  const { currentId } = useWorkspace();
  const client = useQueryClient();
  const projects = useQuery({ queryKey: workspaceQueryKey(currentId, "projects"), queryFn: () => api.projects.list(currentId!), enabled: Boolean(currentId) });
  const sites = useQuery({ queryKey: workspaceQueryKey(currentId, "sites"), queryFn: () => api.sites.list(currentId!), enabled: Boolean(currentId) });
  const [projectName, setProjectName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [message, setMessage] = useState("");
  const createProject = async () => { if (!currentId || !projectName.trim()) return; try { await api.projects.create({ workspace_id: currentId, name: projectName.trim() }); setProjectName(""); setMessage("Project 已创建"); await client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "projects") }); } catch (error) { setMessage(formatApiError(error).message); } };
  const createSite = async () => { if (!currentId || !projectId || !siteName.trim()) return; try { await api.sites.create({ workspace_id: currentId, project_id: projectId, name: siteName.trim() }); setSiteName(""); setMessage("Site 已创建"); await client.invalidateQueries({ queryKey: workspaceQueryKey(currentId, "sites") }); } catch (error) { setMessage(formatApiError(error).message); } };
  if (!currentId) return <Panel><StateView type="empty" title="请选择 Workspace" description="基础资料依赖 Workspace 上下文。" /></Panel>;
  return <><div className="grid grid-2"><Panel><div className="panel-header"><div><h2 className="panel-title">Project</h2><div className="panel-kicker">Workspace 下的研究项目</div></div><Badge tone="info">{projects.data?.items.length ?? 0}</Badge></div><div className="inline-create"><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="新 Project 名称" /><Button onClick={() => void createProject()}><Plus size={14} />创建</Button></div><ResourceRows query={projects} kind="Project" /><JsonAction title="查看 / 更新 Project" hint='填写 {"id":"...","name":"...","description":"..."}' onRun={(payload) => payload.name === undefined ? api.projects.get(text(payload.id)) : api.projects.update(text(payload.id), payload)} onDone={() => projects.refetch()} /></Panel><Panel><div className="panel-header"><div><h2 className="panel-title">Site</h2><div className="panel-kicker">Project 下的现场站点</div></div><Badge tone="info">{sites.data?.items.length ?? 0}</Badge></div><div className="inline-create inline-create-site"><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">选择 Project</option>{projects.data?.items.map((item) => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select><input value={siteName} onChange={(event) => setSiteName(event.target.value)} placeholder="新 Site 名称" /><Button onClick={() => void createSite()}><Plus size={14} />创建</Button></div><ResourceRows query={sites} kind="Site" /><JsonAction title="查看 / 更新 Site" hint='填写 {"id":"...","name":"...","location":"..."}' onRun={(payload) => payload.name === undefined ? api.sites.get(text(payload.id)) : api.sites.update(text(payload.id), payload)} onDone={() => sites.refetch()} /></Panel></div>{message && <div className="command-note section-gap">{message}</div>}</>;
}

function ResourceRows({ query, kind }: { query: any; kind: string }) {
  if (query.isLoading) return <StateView type="loading" title={`正在加载 ${kind}`} description="正在读取基础资料。" />;
  if (query.error) return <StateView type="error" title={`${kind} 加载失败`} description={formatApiError(query.error).message} />;
  if (!query.data?.items.length) return <StateView type="empty" title={`暂无 ${kind}`} description={`创建第一个 ${kind} 后会显示在这里。`} />;
  return <div className="series-list">{query.data.items.map((item: JsonRecord) => <div className="series-row" key={text(item.id)}><div><div className="cell-title">{text(item.name)}</div><div className="cell-sub mono">{text(item.id)}</div></div><Badge tone={item.status === "active" ? "success" : "neutral"}>{text(item.status, "active")}</Badge></div>)}</div>;
}

function AccessTab() {
  const { currentId } = useWorkspace();
  const client = useQueryClient();
  const members = useQuery({ queryKey: workspaceQueryKey(currentId, "members"), queryFn: () => api.members.list(currentId!), enabled: Boolean(currentId) });
  const grants = useQuery({ queryKey: workspaceQueryKey(currentId, "access-grants"), queryFn: () => api.accessGrants.list(currentId!), enabled: Boolean(currentId) });
  const myGrants = useQuery({ queryKey: ["access-grants", "mine"], queryFn: api.accessGrants.mine });
  const invitations = useQuery({ queryKey: workspaceQueryKey(currentId, "invitations"), queryFn: () => api.invitations.list(currentId!), enabled: Boolean(currentId) });
  const myInvitations = useQuery({ queryKey: ["invitations", "mine"], queryFn: api.invitations.mine });
  const catalog = useQuery({ queryKey: ["permissions", "catalog"], queryFn: api.permissions.catalog });
  const refresh = async () => { await client.invalidateQueries({ predicate: (query) => ["workspace", "access-grants", "invitations", "permissions"].includes(String(query.queryKey[0])) }); };
  if (!currentId) return <Panel><StateView type="empty" title="请选择 Workspace" description="访问控制依赖 Workspace 上下文。" /></Panel>;
  return <div className="access-layout"><Panel><div className="panel-header"><div><h2 className="panel-title">内部成员</h2><div className="panel-kicker">长期协作关系</div></div><Users size={16} className="muted" /></div><RecordTable records={members.data?.items} loading={members.isLoading} error={members.error} columns={["user_name", "role_code", "scope_type", "status"]} /><JsonAction title="添加成员" hint='例如 {"email":"user@example.com","role_code":"viewer"}' onRun={(payload) => api.members.add(currentId, payload)} onDone={refresh} /></Panel>
    <Panel><div className="panel-header"><div><h2 className="panel-title">资源授权</h2><div className="panel-kicker">外部用户和临时服务访问</div></div><ShieldCheck size={16} className="muted" /></div><RecordTable records={grants.data?.items} loading={grants.isLoading} error={grants.error} columns={["grantee_name", "scope_type", "role_code", "status", "expires_at"]} /><JsonAction title="创建授权" hint='需要 workspace_id、grantee、role/permissions 和 scope' initial={{ workspace_id: currentId }} onRun={api.accessGrants.create} onDone={refresh} /></Panel>
    <Panel><div className="panel-header"><div><h2 className="panel-title">邀请</h2><div className="panel-kicker">未注册对象接受后转为授权</div></div><Badge tone="warning">{invitations.data?.items.length ?? 0}</Badge></div><RecordTable records={invitations.data?.items} loading={invitations.isLoading} error={invitations.error} columns={["invitee_email", "invitee_phone", "scope_type", "status", "expires_at"]} /><JsonAction title="创建邀请" hint='需要 workspace_id、邮箱或手机号、权限与 scope' initial={{ workspace_id: currentId }} onRun={api.invitations.create} onDone={refresh} /></Panel>
    <Panel><div className="panel-header"><div><h2 className="panel-title">授予我的访问</h2><div className="panel-kicker">授权与待接受邀请</div></div><Badge tone="info">{(myGrants.data?.items.length ?? 0) + (myInvitations.data?.items.length ?? 0)}</Badge></div><RecordTable records={[...(myGrants.data?.items ?? []), ...(myInvitations.data?.items ?? [])]} loading={myGrants.isLoading || myInvitations.isLoading} error={myGrants.error ?? myInvitations.error} columns={["workspace_name", "scope_type", "role_code", "status", "expires_at"]} /></Panel>
    <Panel className="access-full"><div className="panel-header"><div><h2 className="panel-title">访问控制操作</h2><div className="panel-kicker">更新/移除成员、撤销授权、接受或撤销邀请</div></div><ShieldCheck size={16} className="muted" /></div><div className="access-actions"><JsonAction title="更新成员" hint='填写 {"member_id":"...","role_code":"..."}' onRun={(payload) => api.members.update(currentId, text(payload.member_id), payload)} onDone={refresh} /><JsonAction title="移除成员" hint='填写 {"member_id":"..."}' onRun={(payload) => api.members.remove(currentId, text(payload.member_id))} onDone={refresh} /><JsonAction title="撤销授权" hint='填写 {"access_grant_id":"..."}' onRun={(payload) => api.accessGrants.revoke(text(payload.access_grant_id))} onDone={refresh} /><JsonAction title="接受邀请" hint='填写 {"invitation_id":"..."}' onRun={(payload) => api.invitations.accept(text(payload.invitation_id))} onDone={refresh} /><JsonAction title="撤销邀请" hint='填写 {"invitation_id":"..."}' onRun={(payload) => api.invitations.revoke(text(payload.invitation_id))} onDone={refresh} /></div></Panel>
    <Panel className="access-full"><div className="panel-header"><div><h2 className="panel-title">权限目录</h2><div className="panel-kicker">后端可用权限点、分组和模板</div></div><KeyRound size={16} className="muted" /></div>{catalog.error ? <StateView type="error" title="权限目录加载失败" description={formatApiError(catalog.error).message} /> : <pre className="json-view">{json(catalog.data ?? {})}</pre>}</Panel></div>;
}

function AuditTab() {
  const { currentId } = useWorkspace();
  const [limit, setLimit] = useState(100);
  const query = useQuery({ queryKey: workspaceQueryKey(currentId, "audit", String(limit)), queryFn: () => api.audit.list(currentId!, limit), enabled: Boolean(currentId) });
  return <Panel><div className="panel-header"><div><h2 className="panel-title">审计事件</h2><div className="panel-kicker">敏感操作和访问记录</div></div><label className="compact-control">返回数量 <input type="number" min="1" max="500" value={limit} onChange={(event) => setLimit(Number(event.target.value))} /></label></div><RecordTable records={query.data?.items} loading={query.isLoading} error={query.error} columns={["created_at", "actor_type", "action", "resource_type", "result", "request_id", "reason"]} /></Panel>;
}

function SecurityTab() {
  const { user } = useAuth();
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: ["auth", "sessions"], queryFn: api.auth.sessions });
  const mfa = useQuery({ queryKey: ["auth", "mfa"], queryFn: api.auth.mfaStatus });
  const [code, setCode] = useState("");
  const [result, setResult] = useState("");
  const run = async (action: () => Promise<unknown>) => { try { const value = await action(); setResult(value ? json(value) : "操作成功"); await client.invalidateQueries({ queryKey: ["auth"] }); } catch (error) { const value = formatApiError(error); setResult(`${value.message}${value.requestId ? `\nrequest id: ${value.requestId}` : ""}`); } };
  const manualRefresh = () => { const tokens = authStorage.read(); return tokens ? api.auth.refresh(tokens.refreshToken).then((response) => { authStorage.write({ accessToken: response.access_token, refreshToken: response.refresh_token }); return response; }) : Promise.reject(new Error("当前没有 refresh token")); };
  return <div className="grid grid-2"><Panel><div className="panel-header"><div><h2 className="panel-title">账号</h2><div className="panel-kicker">{user?.email ?? user?.phone ?? user?.id}</div></div><Badge tone={user?.is_system_admin ? "info" : "neutral"}>{user?.is_system_admin ? "系统管理员" : "普通账号"}</Badge></div><div className="panel-body form-grid"><div className="header-actions"><Button variant="secondary" onClick={() => void run(manualRefresh)}>手动刷新 Token</Button><Button variant="secondary" onClick={() => void run(api.auth.sendEmailCode)}>发送邮箱验证码</Button></div><label className="field"><span className="field-label">验证码 / TOTP</span><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="6 位验证码" /></label><div className="header-actions"><Button onClick={() => void run(() => api.auth.verifyEmailCode(code))}>验证邮箱</Button><Button variant="secondary" onClick={() => void run(api.auth.mfaSetup)}>设置 MFA</Button><Button variant="secondary" onClick={() => void run(() => api.auth.mfaEnable(code))}>启用 MFA</Button><Button variant="danger" onClick={() => window.confirm("确认禁用 MFA？") && void run(() => api.auth.mfaDisable(code))}>禁用 MFA</Button></div><pre className="json-view compact">{result || json(mfa.data ?? {})}</pre></div></Panel><Panel><div className="panel-header"><div><h2 className="panel-title">登录会话</h2><div className="panel-kicker">Refresh token sessions</div></div><Button variant="secondary" onClick={() => void sessions.refetch()}><RefreshCw size={14} />刷新</Button></div>{sessions.data?.items.length ? <div className="series-list">{sessions.data.items.map((item) => <div className="series-row" key={text(item.id)}><div><div className="cell-title">{text(item.client_name, text(item.id))}</div><div className="cell-sub">{text(item.ip_address)} · {text(item.expires_at)}</div></div><Button variant="danger" onClick={() => window.confirm("确认撤销该会话？") && void run(() => api.auth.revokeSession(text(item.id)))}><Trash2 size={13} />撤销</Button></div>)}</div> : <StateView type={sessions.error ? "error" : sessions.isLoading ? "loading" : "empty"} title={sessions.error ? "会话加载失败" : sessions.isLoading ? "正在加载会话" : "暂无会话"} description={sessions.error ? formatApiError(sessions.error).message : "当前没有其他 refresh session。"} />}</Panel></div>;
}

function RecordTable({ records = [], loading, error, columns }: { records?: JsonRecord[]; loading?: boolean; error?: unknown; columns: string[] }) {
  if (loading) return <StateView type="loading" title="正在加载" description="正在读取服务端数据。" />;
  if (error) return <StateView type="error" title="加载失败" description={formatApiError(error).message} requestId={formatApiError(error).requestId} />;
  if (!records.length) return <StateView type="empty" title="暂无记录" description="服务端当前没有返回可见记录。" />;
  return <div className="table-wrap"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{records.map((record, index) => <tr key={text(record.id, String(index))}>{columns.map((column) => <td key={column}>{column === "status" || column === "result" ? <Badge tone={record[column] === "active" || record[column] === "success" ? "success" : record[column] === "failed" ? "danger" : "neutral"}>{text(record[column])}</Badge> : <span className={column.endsWith("_id") || column === "request_id" ? "mono" : ""}>{text(record[column])}</span>}</td>)}</tr>)}</tbody></table></div>;
}

function JsonAction({ title, hint, initial = {}, onRun, onDone }: { title: string; hint: string; initial?: JsonRecord; onRun: (payload: JsonRecord) => Promise<unknown>; onDone?: () => void | Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(json(initial));
  const [status, setStatus] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); try { const payload = JSON.parse(value) as JsonRecord; const result = await onRun(payload); setStatus(result ? json(result) : "操作成功"); await onDone?.(); } catch (error) { const formatted = formatApiError(error); setStatus(`${formatted.message}${formatted.requestId ? `\nrequest id: ${formatted.requestId}` : ""}`); } };
  return <div className="json-action"><button className="json-action-toggle" onClick={() => setOpen(!open)}><Plus size={13} />{title}</button>{open && <form onSubmit={submit}><div className="field-hint">{hint}</div><textarea value={value} onChange={(event) => setValue(event.target.value)} spellCheck={false} /><Button type="submit">提交</Button>{status && <pre className="json-view compact">{status}</pre>}</form>}</div>;
}
