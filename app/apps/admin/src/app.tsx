import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import {
  Boxes,
  ChevronRight,
  Database,
  FileText,
  Home,
  Settings,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  TableProperties,
  Users,
  UserRound,
} from "lucide-react";
import { Statistic, Space } from "@thcpn/admin-ui";
import { api, formatApiError } from "@thcpn/api";
import { useAdminAuth } from "@thcpn/auth";
import {
  Badge,
  Brand,
  Button,
  CloseButton,
  IconButton,
  PageHeader,
  Panel,
  ServiceStatus,
  StateView,
} from "@thcpn/ui";
const AdminMetadataPage = lazy(() =>
  import("./admin-metadata").then((module) => ({
    default: module.AdminMetadataPage,
  })),
);
const AdminSourcesPage = lazy(() =>
  import("./admin-sources").then((module) => ({
    default: module.AdminSourcesPage,
  })),
);
const AdminDevicesPage = lazy(() =>
  import("./admin-devices").then((module) => ({
    default: module.AdminDevicesPage,
  })),
);
const AdminLogsPage = lazy(() =>
  import("./admin-logs").then((module) => ({
    default: module.AdminLogsPage,
  })),
);
const AdminWorkspacesPage = lazy(() =>
  import("./admin-control").then((module) => ({
    default: module.AdminWorkspacesPage,
  })),
);
const AdminWorkspaceDetailPage = lazy(() =>
  import("./admin-control").then((module) => ({
    default: module.AdminWorkspaceDetailPage,
  })),
);
const AdminUsersPage = lazy(() =>
  import("./admin-users").then((module) => ({
    default: module.AdminUsersPage,
  })),
);
const AdminUserDetailPage = lazy(() =>
  import("./admin-users").then((module) => ({
    default: module.AdminUserDetailPage,
  })),
);
const AdminSettingsPage = lazy(() =>
  import("./admin-control").then((module) => ({
    default: module.AdminSettingsPage,
  })),
);

const adminNav = [
  { to: "/admin", label: "后台总览", icon: Home },
  { to: "/admin/sources", label: "数据源", icon: Database },
  { to: "/admin/devices", label: "系统设备", icon: Boxes },
  { to: "/admin/logs", label: "设备日志", icon: FileText },
  { to: "/admin/workspaces", label: "Workspace 与权限", icon: Users },
  { to: "/admin/users", label: "用户管理", icon: UserRound },
  { to: "/admin/metadata", label: "元数据", icon: TableProperties },
  { to: "/admin/settings", label: "系统设置", icon: Settings },
];
const platformUrl =
  (import.meta.env.VITE_PLATFORM_URL as string | undefined) ??
  "http://127.0.0.1:5173";

function AdminShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("thcpn:sidebar-collapsed") === "true",
  );
  const { admin: user, signOut } = useAdminAuth();
  const health = useQuery({
    queryKey: ["admin-health"],
    queryFn: api.health,
    refetchInterval: 30_000,
  });
  const ready = useQuery({
    queryKey: ["admin-ready"],
    queryFn: api.ready,
    refetchInterval: 30_000,
  });
  const status = (query: typeof health) =>
    query.isLoading ? "loading" : query.isError ? "error" : "ok";
  useEffect(() => {
    localStorage.setItem(
      "thcpn:sidebar-collapsed",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <div className="admin-sidebar-wrap">
        {mobileOpen && (
          <button
            type="button"
            className="mobile-drawer-backdrop"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </div>
      <aside
        className={`sidebar admin-sidebar ${mobileOpen ? "open" : ""}`}
        aria-label="后台导航"
      >
        <div className="sidebar-brand-row">
          <Brand admin />
          <div className="desktop-sidebar-toggle">
            <IconButton
              label="收起侧栏"
              onClick={() => setSidebarCollapsed(true)}
            >
              <PanelLeftClose size={18} />
            </IconButton>
          </div>
          <div className="mobile-close">
            <CloseButton onClick={() => setMobileOpen(false)} />
          </div>
        </div>
        <div
          className="workspace-switcher"
          style={{
            color: "#dbeafa",
            background: "#1a466f",
            borderColor: "#2a608e",
          }}
        >
          <div className="workspace-label" style={{ color: "#dbeafa" }}>
            <span>系统范围</span>
            <ShieldCheck size={12} />
          </div>
          <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700 }}>
            Platform Control Plane
          </div>
          <div style={{ marginTop: 5, color: "#9fc0dc", fontSize: 10 }}>
            Workspace context disabled
          </div>
        </div>
        <nav className="nav-group">
          <div className="nav-title">SYSTEM</div>
          {adminNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/admin"}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <ServiceStatus
            health={status(health)}
            ready={status(ready)}
            onRefresh={() => {
              void health.refetch();
              void ready.refetch();
            }}
          />
          <a
            className="admin-link"
            style={{ color: "#b8d5f1" }}
            href={`${platformUrl}/dashboard`}
          >
            <ChevronRight
              size={13}
              style={{ verticalAlign: "-2px", marginRight: 5 }}
            />
            返回用户平台
          </a>
          <div className="account-row">
            <div className="avatar">{(user?.name ?? "A").slice(0, 1)}</div>
            <div className="account-name">
              <div>{user?.name ?? "系统管理员"}</div>
              <div className="account-role">系统管理员</div>
            </div>
            <IconButton label="退出登录" onClick={() => void signOut()}>
              <LogOut size={15} />
            </IconButton>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar admin-topbar">
          <div className="topbar-left">
            <div className="desktop-sidebar-open">
              <IconButton
                label="展开侧栏"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={18} />
              </IconButton>
            </div>
            <IconButton
              label="打开导航"
              className="mobile-menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={18} />
            </IconButton>
            <div className="topbar-context">
              <span className="mono">THCPN / SYSTEM / </span>平台管理
            </div>
          </div>
          <Space>
            <Badge tone="info">SYSTEM SCOPE</Badge>
            <IconButton
              label="返回平台"
              onClick={() => window.location.assign(`${platformUrl}/dashboard`)}
            >
              <ChevronRight size={18} />
            </IconButton>
          </Space>
        </header>
        <main className="page">
          <Suspense
            fallback={
              <div className="route-placeholder">
                <div className="app-loading">正在加载后台页面…</div>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function Forbidden() {
  return (
    <Panel className="forbidden">
      <StateView
        type="error"
        title="403 · 无权访问系统后台"
        description="系统后台使用独立的管理员账号登录。Workspace Owner 或普通成员权限不能替代系统管理员身份。"
        action={
          <a href={`${platformUrl}/dashboard`}>
            <Button>
              <Home size={15} />
              返回用户平台
            </Button>
          </a>
        }
      />
    </Panel>
  );
}

function RedirectToAdminLogin() {
  useEffect(() => {
    window.location.assign("/admin/login");
  }, []);
  return <div className="app-loading">正在进入管理员登录…</div>;
}
function AdminGuard() {
  const { admin: user, loading } = useAdminAuth();
  if (loading) return <div className="app-loading">正在检查系统权限…</div>;
  if (!user) return <RedirectToAdminLogin />;
  return <AdminShell />;
}

function AdminLoginPage() {
  const { admin, loading, signIn } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (loading) return <div className="app-loading">正在检查管理员会话…</div>;
  if (admin) { window.location.assign("/admin"); return <div className="app-loading">正在进入后台…</div>; }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    try { signIn(await api.adminAuth.login({ email, password })); window.location.assign("/admin"); }
    catch (reason) { setError(formatApiError(reason).message); }
    finally { setBusy(false); }
  };
  return <main className="admin-auth-page"><section className="admin-auth-panel"><div className="brand-mark"><ShieldCheck size={20} /></div><div className="eyebrow">THCPN / SYSTEM CONTROL</div><h1>管理员登录</h1><p>使用独立的系统管理员账号进入平台管理后台。</p><form onSubmit={submit}><label>管理员邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <div className="admin-login-error">{error}</div>}<button type="submit" disabled={busy}>{busy ? "登录中…" : "登录后台"}</button></form><a href={`${platformUrl}/login`}>返回用户平台登录</a></section></main>;
}

async function listAllAdminResources(kind: "projects" | "sites") {
  const workspaces = await api.workspaces.adminList();
  const responses = await Promise.all(
    workspaces.items.map((workspace) =>
      kind === "projects"
        ? api.projects.adminList(String(workspace.id))
        : api.sites.adminList(String(workspace.id)),
    ),
  );
  return { items: responses.flatMap((response) => response.items) };
}
function AdminOverview() {
  const sources = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: api.admin.sources,
  });
  const devices = useQuery({
    queryKey: ["admin", "devices"],
    queryFn: api.admin.devices,
  });
  const workspaces = useQuery({
    queryKey: ["admin", "workspaces"],
    queryFn: api.workspaces.adminList,
  });
  const projects = useQuery({
    queryKey: ["admin", "projects", "all-workspaces"],
    queryFn: () => listAllAdminResources("projects"),
  });
  const sites = useQuery({
    queryKey: ["admin", "sites", "all-workspaces"],
    queryFn: () => listAllAdminResources("sites"),
  });
  const stat = (query: any) =>
    query.isError ? "—" : (query.data?.items.length ?? 0);
  const failures = [
    { name: "Workspace", query: workspaces },
    { name: "Project", query: projects },
    { name: "Site", query: sites },
    { name: "DataSource", query: sources },
    { name: "设备", query: devices },
  ].filter((item) => item.query.isError);
  return (
    <>
      <PageHeader
        eyebrow="System / overview"
        title="后台总览"
        description="平台级 Workspace、Project、Site、设备资产与数据源运行入口。"
        actions={
          <Badge tone="info">
            <ShieldCheck size={13} />
            系统管理员
          </Badge>
        }
      />
      <div className="grid grid-4">
        <Panel
          className={`admin-stat ${workspaces.isError ? "metric-error" : ""}`}
        >
          <Statistic
            title="Workspace"
            value={stat(workspaces)}
            suffix={workspaces.isError ? "不可用" : "个"}
          />
        </Panel>
        <Panel
          className={`admin-stat ${projects.isError || sites.isError ? "metric-error" : ""}`}
        >
          <Statistic
            title="Project / Site"
            value={`${stat(projects)} / ${stat(sites)}`}
          />
        </Panel>
        <Panel
          className={`admin-stat ${sources.isError ? "metric-error" : ""}`}
        >
          <Statistic
            title="数据源"
            value={stat(sources)}
            suffix={sources.isError ? "不可用" : "个"}
          />
        </Panel>
        <Panel
          className={`admin-stat ${devices.isError ? "metric-error" : ""}`}
        >
          <Statistic
            title="系统设备"
            value={stat(devices)}
            suffix={devices.isError ? "不可用" : "台"}
          />
        </Panel>
      </div>
      {failures.length ? (
        <Panel className="section-gap">
          <StateView
            type="error"
            title="部分统计加载失败"
            description={failures
              .map(
                (item) =>
                  `${item.name}：${formatApiError(item.query.error).message}`,
              )
              .join("；")}
            requestId={failures
              .map((item) => formatApiError(item.query.error).requestId)
              .find(Boolean)}
          />
        </Panel>
      ) : null}
      <div className="admin-shortcuts section-gap">
        <Link to="/admin/sources">
          <Database size={17} />
          <span>
            <strong>THCPN 数据源</strong>
            <small>连接配置与设备同步</small>
          </span>
          <ChevronRight size={15} />
        </Link>
        <Link to="/admin/devices">
          <Boxes size={17} />
          <span>
            <strong>系统设备</strong>
            <small>拓扑、分配与生命周期</small>
          </span>
          <ChevronRight size={15} />
        </Link>
      </div>
      <Panel className="section-gap">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">控制平面状态</h2>
            <div className="panel-kicker">
              平台管理不依赖 Workspace Provider
            </div>
          </div>
          <Badge tone="success">已隔离</Badge>
        </div>
        <div className="panel-body">
          <div className="command-note">
            设备注册、DataSource、DSN、Binding、拓扑、能力、生命周期与分配只在系统后台操作；涉及
            Workspace 的动作必须显式选择目标 Workspace。
          </div>
        </div>
      </Panel>
    </>
  );
}

function AdminRoot() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminGuard />}>
        <Route index element={<AdminOverview />} />
        <Route path="sources" element={<AdminSourcesPage />} />
        <Route path="devices" element={<AdminDevicesPage />} />
        <Route path="logs" element={<AdminLogsPage />} />
        <Route path="workspaces" element={<AdminWorkspacesPage />} />
        <Route path="workspaces/:workspaceId" element={<AdminWorkspaceDetailPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/:userId" element={<AdminUserDetailPage />} />
        <Route path="metadata" element={<AdminMetadataPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
export function AdminApp() {
  return <AdminRoot />;
}
