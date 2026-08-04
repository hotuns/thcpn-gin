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
  Activity,
  AlertTriangle,
  Boxes,
  Camera,
  CircleCheck,
  Cpu,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Home,
  MapPinned,
  Languages,
  Network,
  RefreshCw,
  Server,
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
import { Avatar, Dropdown, Menu, Space, Tooltip, type MenuProps } from "antd";
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
import { formatOverviewTime } from "./admin-overview-model";
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

const overviewText = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === "" ? fallback : String(input);
const overviewCount = (query: { isError: boolean; data?: { items: unknown[]; total?: number } }) =>
  query.isError ? undefined : (query.data?.total ?? query.data?.items.length ?? 0);
function AdminOverview() {
  const health = useQuery({
    queryKey: ["system", "health"],
    queryFn: api.health,
    retry: false,
    refetchInterval: 60_000,
  });
  const sources = useQuery({
    queryKey: ["admin", "overview", "sources"],
    queryFn: api.admin.sources,
  });
  const devices = useQuery({
    queryKey: ["admin", "overview", "devices"],
    queryFn: api.admin.devices,
  });
  const workspaces = useQuery({
    queryKey: ["admin", "overview", "workspaces"],
    queryFn: () => api.admin.workspaces.list({ page: 1, page_size: 100 }),
  });
  const users = useQuery({
    queryKey: ["admin", "overview", "users"],
    queryFn: () => api.admin.users.list({ page: 1, page_size: 100 }),
  });
  const errorLogs = useQuery({
    queryKey: ["admin", "overview", "logs", "ERROR"],
    queryFn: () => api.admin.platformLogs({
      start: new Date(Date.now() - 86_400_000).toISOString(),
      end: new Date().toISOString(),
      level: "ERROR",
      page: 1,
      page_size: 6,
    }),
  });
  const warningLogs = useQuery({
    queryKey: ["admin", "overview", "logs", "WARN"],
    queryFn: () => api.admin.platformLogs({
      start: new Date(Date.now() - 86_400_000).toISOString(),
      end: new Date().toISOString(),
      level: "WARN",
      page: 1,
      page_size: 6,
    }),
  });
  const queries = [health, sources, devices, workspaces, users, errorLogs, warningLogs];
  const refreshAll = () => queries.forEach((query) => void query.refetch());
  const refreshing = queries.some((query) => query.isFetching);
  const refreshedAt = Math.max(...queries.map((query) => query.dataUpdatedAt || 0));
  const deviceItems = devices.data?.items ?? [];
  const sourceItems = sources.data?.items ?? [];
  const workspaceItems = workspaces.data?.items ?? [];
  const userItems = users.data?.items ?? [];
  const category = (item: Record<string, unknown>) =>
    overviewText(item.topology_role || item.device_type, "standalone");
  const deviceGroups = {
    gateway: deviceItems.filter((item) => category(item) === "gateway").length,
    gateway_node: deviceItems.filter((item) => category(item) === "gateway_node").length,
    standalone: deviceItems.filter((item) => category(item) === "standalone").length,
    camera: deviceItems.filter((item) => category(item) === "camera").length,
  };
  const unassignedDevices = deviceItems.filter((item) => !item.workspace_id).length;
  const pendingDevices = deviceItems.filter((item) => item.lifecycle_status === "pending_enrollment").length;
  const inactiveSources = sourceItems.filter((item) => item.status !== "active").length;
  const restrictedUsers = userItems.filter((item) => item.locked || item.status === "disabled").length;
  const disabledWorkspaces = workspaceItems.filter((item) => item.status === "disabled").length;
  const recentLogs = [...(errorLogs.data?.items ?? []), ...(warningLogs.data?.items ?? [])]
    .sort((a, b) => new Date(String(b.timestamp ?? b.time ?? 0)).getTime() - new Date(String(a.timestamp ?? a.time ?? 0)).getTime())
    .slice(0, 6);
  const attentionItems = [
    { label: "未分配设备", count: unassignedDevices, detail: "尚未进入任何工作区", to: "/admin/devices", tone: unassignedDevices ? "warning" : "success" },
    { label: "待登记设备", count: pendingDevices, detail: "生命周期仍处于待登记", to: "/admin/devices", tone: pendingDevices ? "warning" : "success" },
    { label: "异常数据源", count: inactiveSources, detail: "已停用或状态异常", to: "/admin/sources", tone: inactiveSources ? "danger" : "success" },
    { label: "受限用户", count: restrictedUsers, detail: "账号停用或已锁定", to: "/admin/users", tone: restrictedUsers ? "danger" : "success" },
    { label: "停用工作区", count: disabledWorkspaces, detail: "当前不可正常使用", to: "/admin/workspaces?status=disabled", tone: disabledWorkspaces ? "warning" : "success" },
  ] as const;
  const metrics = [
    { label: "系统设备", value: overviewCount(devices), suffix: "台", issue: unassignedDevices, issueLabel: "未分配", icon: Boxes, to: "/admin/devices" },
    { label: "数据源", value: overviewCount(sources), suffix: "个", issue: inactiveSources, issueLabel: "异常", icon: Database, to: "/admin/sources" },
    { label: "平台用户", value: overviewCount(users), suffix: "人", issue: restrictedUsers, issueLabel: "受限", icon: UserRound, to: "/admin/users" },
    { label: "工作区", value: overviewCount(workspaces), suffix: "个", issue: disabledWorkspaces, issueLabel: "停用", icon: Network, to: "/admin/workspaces" },
  ];
  return (
    <>
      <PageHeader
        eyebrow="System / overview"
        title="后台总览"
        description="查看平台运行状态、资产规模、异常事项与近期系统事件。"
        actions={
          <Space>
            <Badge tone={health.isSuccess ? "success" : health.isLoading ? "neutral" : "danger"}>
              {health.isSuccess ? <CircleCheck size={13} /> : <AlertTriangle size={13} />}
              API {health.isSuccess ? "运行正常" : health.isLoading ? "检查中" : "不可用"}
            </Badge>
            <Button variant="secondary" onClick={refreshAll} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "admin-spin" : ""} />
              刷新
            </Button>
          </Space>
        }
      />
      <div className="admin-overview-status">
        <div><Server size={16} /><span>API 服务</span><strong>{health.isSuccess ? overviewText(health.data.status, "正常") : health.isLoading ? "检查中" : "连接失败"}</strong></div>
        <div><Activity size={16} /><span>24 小时事件</span><strong>{(errorLogs.data?.total ?? errorLogs.data?.items.length ?? 0)} 错误 / {(warningLogs.data?.total ?? warningLogs.data?.items.length ?? 0)} 警告</strong></div>
        <div className="admin-overview-refreshed"><span>数据更新时间</span><strong>{refreshedAt ? formatOverviewTime(refreshedAt, document.documentElement.lang || "zh-CN") : "正在加载"}</strong></div>
      </div>
      <div className="admin-overview-metrics section-gap">
        {metrics.map((metric) => <Link key={metric.label} to={metric.to} className={metric.value === undefined ? "metric-error" : ""}>
          <metric.icon size={18} />
          <span>{metric.label}</span>
          <strong>{metric.value ?? "—"}<small>{metric.value === undefined ? "不可用" : metric.suffix}</small></strong>
          <em className={metric.issue ? "has-issue" : ""}>{metric.value === undefined ? "加载失败" : metric.issue ? `${metric.issue} ${metric.issueLabel}` : "状态正常"}</em>
        </Link>)}
      </div>
      <div className="admin-overview-main section-gap">
        <Panel className="admin-overview-panel">
          <div className="admin-overview-panel-head"><div><h2>待处理事项</h2><span>需要系统管理员关注的资产与账号状态</span></div><Badge tone={attentionItems.some((item) => item.count) ? "warning" : "success"}>{attentionItems.reduce((sum, item) => sum + item.count, 0)} 项</Badge></div>
          <div className="admin-attention-list">
            {attentionItems.map((item) => <Link key={item.label} to={item.to}>
              <span className={`admin-attention-dot ${item.tone}`} />
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              <b>{item.count}</b><ChevronRight size={14} />
            </Link>)}
          </div>
        </Panel>
        <Panel className="admin-overview-panel admin-recent-events">
          <div className="admin-overview-panel-head"><div><h2>近期系统事件</h2><span>过去 24 小时最新错误与警告</span></div><Link to="/admin/logs">查看全部 <ChevronRight size={13} /></Link></div>
          {errorLogs.isError && warningLogs.isError ? <div className="admin-overview-empty">日志服务暂时不可用</div> : recentLogs.length ? <div className="admin-event-list">
            {recentLogs.map((item, index) => <Link to="/admin/logs" key={overviewText(item.id, `${item.timestamp}-${index}`)}>
              <Badge tone={String(item.level).toUpperCase() === "ERROR" ? "danger" : "warning"}>{overviewText(item.level)}</Badge>
              <span><strong>{overviewText(item.message)}</strong><small>{overviewText(item.service, "SYSTEM").toUpperCase()} · {overviewText(item.path, overviewText(item.request_id, "系统事件"))}</small></span>
              <time>{formatOverviewTime(item.timestamp ?? item.time, document.documentElement.lang || "zh-CN")}</time>
            </Link>)}
          </div> : <div className="admin-overview-empty"><CircleCheck size={18} />过去 24 小时没有错误或警告</div>}
        </Panel>
      </div>
      <div className="admin-overview-bottom section-gap">
        <Panel className="admin-overview-panel">
          <div className="admin-overview-panel-head"><div><h2>设备资产结构</h2><span>当前系统登记的设备类型</span></div><Link to="/admin/devices">设备管理 <ChevronRight size={13} /></Link></div>
          <div className="admin-device-estate">
            <div><Network size={17} /><span>网关</span><strong>{devices.isError ? "—" : deviceGroups.gateway}</strong></div>
            <div><Cpu size={17} /><span>节点</span><strong>{devices.isError ? "—" : deviceGroups.gateway_node}</strong></div>
            <div><Server size={17} /><span>标准站</span><strong>{devices.isError ? "—" : deviceGroups.standalone}</strong></div>
            <div><Camera size={17} /><span>相机</span><strong>{devices.isError ? "—" : deviceGroups.camera}</strong></div>
          </div>
        </Panel>
        <Panel className="admin-overview-panel">
          <div className="admin-overview-panel-head"><div><h2>常用操作</h2><span>系统资产与运行维护入口</span></div></div>
          <div className="admin-overview-shortcuts">
            <Link to="/admin/sources"><Database size={16} /><span><strong>数据源与同步</strong><small>连接配置、单设备与全量同步</small></span><ChevronRight size={14} /></Link>
            <Link to="/admin/devices"><Boxes size={16} /><span><strong>设备管理</strong><small>拓扑、分配和生命周期</small></span><ChevronRight size={14} /></Link>
            <Link to="/admin/sensors"><Cpu size={16} /><span><strong>传感器模板</strong><small>协议参数与遥测指标</small></span><ChevronRight size={14} /></Link>
            <Link to="/admin/logs"><Activity size={16} /><span><strong>平台日志</strong><small>错误诊断与请求检索</small></span><ChevronRight size={14} /></Link>
          </div>
        </Panel>
      </div>
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
