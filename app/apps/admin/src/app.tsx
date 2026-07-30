import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Boxes,
  Cpu,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Home,
  MapPinned,
  Languages,
  Settings,
  LogOut,
  Menu as MenuIcon,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
  TableProperties,
  UserRound,
} from "lucide-react";
import { Avatar, Dropdown, Menu, Statistic, Space, Tooltip, type MenuProps } from "antd";
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
  StateView,
} from "@thcpn/ui";
import { LanguageSwitcher, useLocale, useTheme } from "@thcpn/i18n";
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
const AdminSensorsPage = lazy(() =>
  import("./admin-sensors").then((module) => ({
    default: module.AdminSensorsPage,
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
const AdminDeviceInsightsPage = lazy(() => import("./admin-device-insights").then((module) => ({ default: module.AdminDeviceInsightsPage })));
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
  { to: "/admin", key: "overview", icon: Home, group: "overview" },
  { to: "/admin/sources", key: "sources", icon: Database, group: "assets" },
  { to: "/admin/devices", key: "devices", icon: Boxes, group: "assets" },
  { to: "/admin/sensors", key: "sensors", icon: Cpu, group: "assets" },
  { to: "/admin/device-map", key: "deviceMap", icon: MapPinned, group: "assets" },
  { to: "/admin/logs", key: "logs", icon: FileText, group: "system" },
  { to: "/admin/users", key: "users", icon: UserRound, group: "platform" },
  { to: "/admin/metadata", key: "metadata", icon: TableProperties, group: "platform" },
  { to: "/admin/settings", key: "settings", icon: Settings, group: "system" },
] as const;
const platformUrl =
  (import.meta.env.VITE_PLATFORM_URL as string | undefined) ??
  "http://127.0.0.1:5173";

function AdminShell() {
  const { locale, setLocale, t } = useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("thcpn:sidebar-collapsed") === "true",
  );
  const { admin: user, signOut } = useAdminAuth();
  const selectedNav = adminNav.find((item) =>
    item.to === "/admin"
      ? location.pathname === "/admin"
      : location.pathname.startsWith(item.to),
  );
  const selectedKey = selectedNav?.to ?? "";
  const groupedItems: MenuProps["items"] = [
    {
      type: "group",
      label: t("admin:navigationGroups.overview"),
      children: adminNav.filter((item) => item.group === "overview").map((item) => ({ key: item.to, icon: <item.icon size={16} />, label: t(`admin:navigation.${item.key}`) })),
    },
    {
      type: "group",
      label: t("admin:navigationGroups.assets"),
      children: adminNav.filter((item) => item.group === "assets").map((item) => ({ key: item.to, icon: <item.icon size={16} />, label: t(`admin:navigation.${item.key}`) })),
    },
    {
      type: "group",
      label: t("admin:navigationGroups.platform"),
      children: adminNav.filter((item) => item.group === "platform").map((item) => ({ key: item.to, icon: <item.icon size={16} />, label: t(`admin:navigation.${item.key}`) })),
    },
    {
      type: "group",
      label: t("admin:navigationGroups.system"),
      children: adminNav.filter((item) => item.group === "system").map((item) => ({ key: item.to, icon: <item.icon size={16} />, label: t(`admin:navigation.${item.key}`) })),
    },
  ];
  const accountItems: MenuProps["items"] = [
    { key: "identity", label: <div className="admin-account-identity"><strong>{user?.name ?? t("admin:administrator")}</strong><span>{user?.email ?? t("admin:administrator")}</span></div>, disabled: true },
    { type: "divider" },
    { key: "zh-CN", icon: <Languages size={15} />, label: t("chinese"), extra: locale === "zh-CN" ? "✓" : undefined },
    { key: "en-US", icon: <Languages size={15} />, label: "English", extra: locale === "en-US" ? "✓" : undefined },
    { type: "divider" },
    { key: "platform", icon: <ExternalLink size={15} />, label: t("admin:navigation.backPlatform") },
    { key: "logout", danger: true, icon: <LogOut size={15} />, label: t("platform:navigation.logout") },
  ];
  const handleAccountAction: MenuProps["onClick"] = ({ key }) => {
    if (key === "zh-CN" || key === "en-US") void setLocale(key);
    if (key === "platform") window.location.assign(`${platformUrl}/dashboard`);
    if (key === "logout") void signOut();
  };
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
            aria-label={t("closeNavigation")}
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
        <Menu
          className="admin-navigation"
          theme="dark"
          mode="inline"
          items={groupedItems}
          selectedKeys={selectedKey ? [selectedKey] : []}
          onClick={({ key }) => {
            navigate(key);
            setMobileOpen(false);
          }}
        />
        <div className="sidebar-footer">
          <Dropdown menu={{ items: accountItems, onClick: handleAccountAction }} trigger={["click"]} placement="topLeft">
            <button type="button" className="admin-account-trigger" aria-label={t("admin:accountMenu")}>
              <Avatar size={32}>{(user?.name ?? "A").slice(0, 1).toUpperCase()}</Avatar>
              <span><strong>{user?.name ?? t("admin:administrator")}</strong><small>{t("admin:administrator")}</small></span>
              <ChevronDown size={15} />
            </button>
          </Dropdown>
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
              <MenuIcon size={18} />
            </IconButton>
            <div className="topbar-context">
              <span>{t("admin:title")}</span>
              <span className="breadcrumb-separator">/</span>
              <strong>{selectedNav ? t(`admin:navigation.${selectedNav.key}`) : t("admin:title")}</strong>
            </div>
          </div>
          <Space>
            <Tooltip title={resolvedTheme === "dark" ? t("themeLight") : t("themeDark")}>
              <IconButton
                label={resolvedTheme === "dark" ? t("themeLight") : t("themeDark")}
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              >
                {resolvedTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              </IconButton>
            </Tooltip>
            <Tooltip title={t("admin:navigation.backPlatform")}>
              <IconButton label={t("admin:navigation.backPlatform")} onClick={() => window.location.assign(`${platformUrl}/dashboard`)}>
                <ExternalLink size={17} />
              </IconButton>
            </Tooltip>
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
        description="系统后台使用独立的管理员账号登录。工作区负责人或普通成员权限不能替代系统管理员身份。"
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
  const { t } = useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const { admin, loading, signIn } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (loading) return <div className="app-loading">{t("admin:auth.checking")}</div>;
  if (admin) { window.location.assign("/admin"); return <div className="app-loading">{t("admin:auth.entering")}</div>; }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    try { signIn(await api.adminAuth.login({ email, password })); window.location.assign("/admin"); }
    catch (reason) { setError(formatApiError(reason).message); }
    finally { setBusy(false); }
  };
  return <main className="admin-auth-page"><div className="admin-auth-actions"><LanguageSwitcher compact /><Tooltip title={resolvedTheme === "dark" ? t("themeLight") : t("themeDark")}><IconButton label={resolvedTheme === "dark" ? t("themeLight") : t("themeDark")} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>{resolvedTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</IconButton></Tooltip></div><section className="admin-auth-panel"><div className="brand-mark"><ShieldCheck size={20} /></div><div className="eyebrow">THCPN / SYSTEM CONTROL</div><h1>{t("admin:auth.title")}</h1><p>{t("admin:auth.copy")}</p><form onSubmit={submit}><label>{t("admin:auth.email")}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>{t("admin:auth.password")}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <div className="admin-login-error">{error}</div>}<button type="submit" disabled={busy}>{busy ? t("admin:auth.signingIn") : t("admin:auth.submit")}</button></form><a href={`${platformUrl}/login`}>{t("admin:auth.back")}</a></section></main>;
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
    { name: "工作区", query: workspaces },
    { name: "项目", query: projects },
    { name: "站点", query: sites },
    { name: "DataSource", query: sources },
    { name: "设备", query: devices },
  ].filter((item) => item.query.isError);
  return (
    <>
      <PageHeader
        eyebrow="System / overview"
        title="后台总览"
        description="平台级工作区、项目、站点、设备资产与数据源运行入口。"
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
            title="工作区"
            value={stat(workspaces)}
            suffix={workspaces.isError ? "不可用" : "个"}
          />
        </Panel>
        <Panel
          className={`admin-stat ${projects.isError || sites.isError ? "metric-error" : ""}`}
        >
          <Statistic
            title="项目 / 站点"
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
              平台管理独立于用户工作区
            </div>
          </div>
          <Badge tone="success">已隔离</Badge>
        </div>
        <div className="panel-body">
          <div className="command-note">
            设备注册、DataSource、DSN、Binding、拓扑、能力、生命周期与分配只在系统后台操作；涉及工作区的操作必须显式选择目标工作区。
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
        <Route path="devices/:deviceId" element={<AdminDevicesPage />} />
        <Route path="sensors" element={<AdminSensorsPage />} />
        <Route path="device-map" element={<AdminDeviceInsightsPage />} />
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
