import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, api, clearStoredToken, getStoredRefreshToken, getStoredToken, storeToken } from "./api";
import type {
  Actor,
  AuthSession,
  InternalMemberRoleCode,
  LoginResponse,
  OrganizationType,
  StatusResponse,
  WorkspaceMember,
  WorkspaceWithMembership
} from "./types";

const organizationTypes: OrganizationType[] = [
  "lab",
  "institution",
  "company",
  "government",
  "service_provider",
  "other"
];

const memberRoles: InternalMemberRoleCode[] = [
  "owner",
  "admin",
  "project_manager",
  "site_operator",
  "data_manager",
  "researcher",
  "viewer"
];

type SelectorKind = "email" | "phone" | "user_id";

function App() {
  const [token, setToken] = useState(getStoredToken());
  const [refreshToken, setRefreshToken] = useState(getStoredRefreshToken());
  const [currentUser, setCurrentUser] = useState<Actor | null>(null);
  const [healthz, setHealthz] = useState<StatusResponse | null>(null);
  const [readyz, setReadyz] = useState<StatusResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithMembership[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, InternalMemberRoleCode>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [passwordRegister, setPasswordRegister] = useState({
    name: "",
    phone: "",
    email: "",
    password: ""
  });
  const [passwordLogin, setPasswordLogin] = useState({
    identifier: "",
    password: ""
  });
  const [sms, setSms] = useState({
    phone: "",
    code: "",
    name: ""
  });
  const [workspaceForm, setWorkspaceForm] = useState({
    name: "",
    organization_type: "lab" as OrganizationType
  });
  const [memberForm, setMemberForm] = useState({
    selector: "email" as SelectorKind,
    value: "",
    role_code: "viewer" as InternalMemberRoleCode
  });

  const selectedWorkspace = useMemo(
    () => workspaces.find((item) => item.workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, workspaces]
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshSessionData();
  }, [token]);

  async function run(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadAuthenticatedData(messageText: string, preserveWorkspaceSelection = true) {
    const [me, list, sessionList] = await Promise.all([api.me(), api.listWorkspaces(), api.listAuthSessions()]);
    setCurrentUser(me.user);
    setWorkspaces(list.items);
    setSessions(sessionList.items);
    setSelectedWorkspaceId((current) =>
      preserveWorkspaceSelection ? current || list.items[0]?.workspace.id || "" : list.items[0]?.workspace.id || ""
    );
    setMessage(messageText);
  }

  async function refreshSessionData() {
    await run(async () => {
      await loadAuthenticatedData("已加载当前用户、Workspace 和活跃会话。");
    });
  }

  async function loadWorkspaces() {
    await run(async () => {
      const result = await api.listWorkspaces();
      setWorkspaces(result.items);
      setSelectedWorkspaceId((current) => current || result.items[0]?.workspace.id || "");
      setMessage(`已加载 ${result.items.length} 个 Workspace。`);
    });
  }

  async function loadMembers(workspaceId = selectedWorkspaceId) {
    if (!workspaceId) {
      setError("请先选择 Workspace。");
      return;
    }

    await run(async () => {
      const result = await api.listMembers(workspaceId);
      setMembers(result.items);
      setMemberRoleDrafts(
        Object.fromEntries(result.items.map((member) => [member.id, member.role.code as InternalMemberRoleCode]))
      );
      setMessage(`已加载 ${result.items.length} 个成员。`);
    });
  }

  function applyLogin(result: LoginResponse, messageText = result.created ? "账号已创建并登录。" : "登录成功。") {
    storeToken(result.access_token, result.refresh_token);
    setToken(result.access_token);
    setRefreshToken(result.refresh_token);
    setCurrentUser({
      id: result.user.id,
      name: result.user.name,
      phone: result.user.phone,
      email: result.user.email,
      status: result.user.status
    });
    setMessage(messageText);
  }

  async function handlePasswordRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await api.registerWithPassword(passwordRegister);
      applyLogin(result);
      await loadAuthenticatedData("账号已创建并登录。", false);
    });
  }

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await api.loginWithPassword(passwordLogin);
      applyLogin(result);
      await loadAuthenticatedData("登录成功。", false);
    });
  }

  async function handleSendSms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await api.sendSms(sms.phone);
      setMessage(`短信请求成功，有效期 ${result.expires_in} 秒，冷却 ${result.cooldown_seconds} 秒。`);
    });
  }

  async function handleSmsLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await api.loginWithSms(sms);
      applyLogin(result);
      await loadAuthenticatedData(result.created ? "账号已创建并登录。" : "登录成功。", false);
    });
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const created = await api.createWorkspace(workspaceForm);
      const result = await api.listWorkspaces();
      setWorkspaces(result.items);
      setSelectedWorkspaceId(created.workspace.id);
      setWorkspaceForm({ name: "", organization_type: "lab" });
      setMessage("Workspace 已创建。");
    });
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspaceId) {
      setError("请先选择 Workspace。");
      return;
    }

    await run(async () => {
      await api.addMember(selectedWorkspaceId, {
        [memberForm.selector]: memberForm.value.trim(),
        role_code: memberForm.role_code
      });
      setMemberForm({ selector: memberForm.selector, value: "", role_code: "viewer" });
      await loadMembers(selectedWorkspaceId);
      setMessage("成员已添加。");
    });
  }

  async function updateMemberRole(member: WorkspaceMember) {
    await run(async () => {
      await api.updateMemberRole(selectedWorkspaceId, member.id, memberRoleDrafts[member.id]);
      await loadMembers(selectedWorkspaceId);
      setMessage("成员角色已更新。");
    });
  }

  async function removeMember(member: WorkspaceMember) {
    await run(async () => {
      await api.removeMember(selectedWorkspaceId, member.id);
      await loadMembers(selectedWorkspaceId);
      setMessage("成员已删除。");
    });
  }

  async function loadAuthSessions() {
    if (!token) {
      setError("请先登录。");
      return;
    }

    await run(async () => {
      const result = await api.listAuthSessions();
      setSessions(result.items);
      setMessage(`已加载 ${result.items.length} 个活跃会话。`);
    });
  }

  async function refreshAuthToken() {
    if (!refreshToken) {
      setError("没有可用 refresh token，请重新登录。");
      return;
    }

    await run(async () => {
      const result = await api.refreshAuth(refreshToken);
      applyLogin(result, "access token 已刷新，refresh session 已轮换。");
      await loadAuthenticatedData("access token 已刷新，refresh session 已轮换。");
    });
  }

  async function revokeSession(session: AuthSession) {
    if (!window.confirm(`撤销会话 ${session.id}？`)) {
      return;
    }

    await run(async () => {
      await api.revokeAuthSession(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setMessage("会话已撤销。");
    });
  }

  async function logout() {
    const storedRefreshToken = getStoredRefreshToken();

    setLoading(true);
    setError("");
    setMessage("");
    try {
      if (token) {
        await api.logout(storedRefreshToken || undefined);
      }
      setMessage("已退出登录，服务端会话已撤销。");
    } catch (err) {
      setError(`${formatError(err)}；本地登录状态已清除。`);
    } finally {
      clearStoredToken();
      setToken("");
      setRefreshToken("");
      setCurrentUser(null);
      setWorkspaces([]);
      setSelectedWorkspaceId("");
      setMembers([]);
      setSessions([]);
      setMemberRoleDrafts({});
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>THCPN API Console</h1>
          <p>本地开发前端，使用 Vite proxy 调用后端 API。</p>
        </div>
        <div className="token-panel">
          <span className={token ? "status status-ok" : "status"}>{token ? "已登录" : "未登录"}</span>
          {token ? <button onClick={() => void logout()}>退出登录</button> : null}
        </div>
      </header>

      <StatusBar message={message} error={error} loading={loading} />

      <section className="panel">
        <h2>服务状态</h2>
        <div className="button-row">
          <button onClick={() => void run(async () => setHealthz(await api.healthz()))}>检查 healthz</button>
          <button onClick={() => void run(async () => setReadyz(await api.readyz()))}>检查 readyz</button>
        </div>
        <pre>{JSON.stringify({ healthz, readyz }, null, 2)}</pre>
      </section>

      <section className="grid">
        <section className="panel">
          <h2>密码注册</h2>
          <form onSubmit={handlePasswordRegister}>
            <TextInput label="名称" value={passwordRegister.name} onChange={(name) => setPasswordRegister({ ...passwordRegister, name })} />
            <TextInput label="手机号" value={passwordRegister.phone} onChange={(phone) => setPasswordRegister({ ...passwordRegister, phone })} />
            <TextInput label="邮箱" value={passwordRegister.email} onChange={(email) => setPasswordRegister({ ...passwordRegister, email })} />
            <TextInput
              label="密码"
              type="password"
              value={passwordRegister.password}
              onChange={(password) => setPasswordRegister({ ...passwordRegister, password })}
            />
            <button type="submit">注册并登录</button>
          </form>
        </section>

        <section className="panel">
          <h2>密码登录</h2>
          <form onSubmit={handlePasswordLogin}>
            <TextInput
              label="手机号或邮箱"
              value={passwordLogin.identifier}
              onChange={(identifier) => setPasswordLogin({ ...passwordLogin, identifier })}
            />
            <TextInput
              label="密码"
              type="password"
              value={passwordLogin.password}
              onChange={(password) => setPasswordLogin({ ...passwordLogin, password })}
            />
            <button type="submit">登录</button>
          </form>
        </section>

        <section className="panel">
          <h2>短信登录</h2>
          <p className="hint">本地 SMS_PROVIDER=log 时，验证码在后端 API 日志里。</p>
          <form onSubmit={handleSendSms}>
            <TextInput label="手机号" value={sms.phone} onChange={(phone) => setSms({ ...sms, phone })} />
            <button type="submit">发送验证码</button>
          </form>
          <form onSubmit={handleSmsLogin}>
            <TextInput label="验证码" value={sms.code} onChange={(code) => setSms({ ...sms, code })} />
            <TextInput label="名称" value={sms.name} onChange={(name) => setSms({ ...sms, name })} />
            <button type="submit">短信登录</button>
          </form>
        </section>
      </section>

      <section className="panel">
        <h2>当前用户</h2>
        <div className="button-row">
          <button onClick={() => void refreshSessionData()} disabled={!token}>
            加载 /me、Workspace 和会话
          </button>
          <button onClick={() => void refreshAuthToken()} disabled={!refreshToken}>
            刷新 access token
          </button>
          <span className={refreshToken ? "status status-ok" : "status"}>
            {refreshToken ? "refresh token 已保存" : "无 refresh token"}
          </span>
        </div>
        <pre>{JSON.stringify({ token: token ? `${token.slice(0, 24)}...` : "", currentUser }, null, 2)}</pre>
      </section>

      <section className="panel">
        <h2>会话管理</h2>
        <div className="button-row">
          <button onClick={() => void loadAuthSessions()} disabled={!token}>
            刷新会话
          </button>
          <span className="status">活跃会话 {sessions.length}</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>客户端</th>
                <th>IP</th>
                <th>最近使用</th>
                <th>创建时间</th>
                <th>过期时间</th>
                <th>ID</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="hint">
                    暂无活跃会话。
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.user_agent || "-"}</td>
                    <td>{session.client_ip || "-"}</td>
                    <td>{formatDateTime(session.last_used_at)}</td>
                    <td>{formatDateTime(session.created_at)}</td>
                    <td>{formatDateTime(session.expires_at)}</td>
                    <td className="mono">{session.id}</td>
                    <td>
                      <button className="danger" onClick={() => void revokeSession(session)}>
                        撤销
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Workspace</h2>
        <form className="inline-form" onSubmit={handleCreateWorkspace}>
          <TextInput label="名称" value={workspaceForm.name} onChange={(name) => setWorkspaceForm({ ...workspaceForm, name })} />
          <label>
            organization_type
            <select
              value={workspaceForm.organization_type}
              onChange={(event) =>
                setWorkspaceForm({ ...workspaceForm, organization_type: event.target.value as OrganizationType })
              }
            >
              {organizationTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!token}>
            创建组织 Workspace
          </button>
          <button type="button" onClick={() => void loadWorkspaces()} disabled={!token}>
            刷新列表
          </button>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>选择</th>
                <th>名称</th>
                <th>类型</th>
                <th>角色</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((item) => (
                <tr key={item.workspace.id}>
                  <td>
                    <button onClick={() => setSelectedWorkspaceId(item.workspace.id)}>选择</button>
                  </td>
                  <td>{item.workspace.name}</td>
                  <td>{item.workspace.type}</td>
                  <td>{item.membership.role.code}</td>
                  <td className="mono">{item.workspace.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>成员管理</h2>
        <p className="hint">当前 Workspace：{selectedWorkspace?.workspace.name || "未选择"}</p>
        <div className="button-row">
          <button onClick={() => void loadMembers()} disabled={!selectedWorkspaceId}>
            加载成员
          </button>
        </div>

        <form className="inline-form" onSubmit={handleAddMember}>
          <label>
            指定方式
            <select
              value={memberForm.selector}
              onChange={(event) => setMemberForm({ ...memberForm, selector: event.target.value as SelectorKind })}
            >
              <option value="email">email</option>
              <option value="phone">phone</option>
              <option value="user_id">user_id</option>
            </select>
          </label>
          <TextInput label="值" value={memberForm.value} onChange={(value) => setMemberForm({ ...memberForm, value })} />
          <RoleSelect
            label="角色"
            value={memberForm.role_code}
            onChange={(role_code) => setMemberForm({ ...memberForm, role_code })}
          />
          <button type="submit" disabled={!selectedWorkspaceId}>
            添加成员
          </button>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>用户</th>
                <th>联系方式</th>
                <th>状态</th>
                <th>角色</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div>{member.user.name}</div>
                    <div className="mono">{member.user.id}</div>
                  </td>
                  <td>
                    <div>{member.user.email || "-"}</div>
                    <div>{member.user.phone || "-"}</div>
                  </td>
                  <td>{member.status}</td>
                  <td>
                    <RoleSelect
                      label=""
                      value={memberRoleDrafts[member.id] ?? (member.role.code as InternalMemberRoleCode)}
                      onChange={(role) => setMemberRoleDrafts({ ...memberRoleDrafts, [member.id]: role })}
                    />
                  </td>
                  <td className="button-row">
                    <button onClick={() => void updateMemberRole(member)}>更新角色</button>
                    <button className="danger" onClick={() => void removeMember(member)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function TextInput(props: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function RoleSelect(props: {
  label: string;
  value: InternalMemberRoleCode;
  onChange: (value: InternalMemberRoleCode) => void;
}) {
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(event.target.value as InternalMemberRoleCode)}>
        {memberRoles.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function StatusBar(props: { message: string; error: string; loading: boolean }) {
  return (
    <div className="status-bar" aria-live="polite">
      {props.loading ? <span className="status">请求中...</span> : null}
      {props.message ? <span className="status status-ok">{props.message}</span> : null}
      {props.error ? <span className="status status-error">{props.error}</span> : null}
    </div>
  );
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.code ? `${err.code}: ` : "";
    const requestId = err.requestId ? ` request_id=${err.requestId}` : "";
    return `${code}${err.message}${requestId}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "unknown error";
}

export default App;
