import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  BarChart3,
  Boxes,
  Building2,
  CircleUserRound,
  Download,
  Gauge,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  Table2,
  Truck,
  X,
} from "lucide-react";
import {
  api,
  commonStatusLabel,
  formatApiError,
  roleTemplateLabel,
} from "@thcpn/api";
import { RequireAuth, useAuth } from "@thcpn/auth";
import {
  useWorkspace,
  workspaceQueryKey,
  WorkspaceProvider,
} from "@thcpn/workspace";
import {
  Badge,
  Brand,
  Button,
  CloseButton,
  IconButton,
  MobileMenuButton,
  PageHeader,
  Panel,
  ServiceStatus,
  StateView,
} from "@thcpn/ui";
const DevicesPage = lazy(() =>
  import("./devices-page").then((module) => ({ default: module.DevicesPage })),
);
const DeviceCenterDetailPage = lazy(() =>
  import("./devices-page").then((module) => ({
    default: module.DeviceCenterDetailPage,
  })),
);
const LegacyDeviceDataRedirect = lazy(() =>
  import("./devices-page").then((module) => ({
    default: module.LegacyDeviceDataRedirect,
  })),
);
const DatasetsPage = lazy(() =>
  import("./datasets-page").then((module) => ({
    default: module.DatasetsPage,
  })),
);
const DatasetDetailPage = lazy(() =>
  import("./datasets-page").then((module) => ({
    default: module.DatasetDetailPage,
  })),
);
const ExportsPage = lazy(() =>
  import("./exports-page").then((module) => ({ default: module.ExportsPage })),
);
const SettingsPage = lazy(() =>
  import("./settings").then((module) => ({ default: module.SettingsPage })),
);
const AuthPage = lazy(() =>
  import("./auth-pages").then((module) => ({ default: module.AuthPage })),
);
const DashboardPage = lazy(() =>
  import("./dashboard-page").then((module) => ({
    default: module.DashboardPage,
  })),
);

const navGroups = [
  {
    label: "运行",
    items: [
      { to: "/dashboard", label: "总览", icon: Gauge },
      { to: "/devices", label: "设备", icon: Boxes },
    ],
  },
  {
    label: "数据",
    items: [
      { to: "/datasets", label: "数据集", icon: Table2 },
      { to: "/exports", label: "导出任务", icon: Download },
    ],
  },
  {
    label: "管理",
    items: [
      { to: "/workspaces", label: "Workspace", icon: Building2 },
      { to: "/settings", label: "设置", icon: Settings },
    ],
  },
];

function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("thcpn:sidebar-collapsed") === "true",
  );
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 30_000,
  });
  const ready = useQuery({
    queryKey: ["ready"],
    queryFn: api.ready,
    refetchInterval: 30_000,
  });
  const location = useLocation();
  const serviceStatus = (query: typeof health) =>
    query.isLoading ? "loading" : query.isError ? "error" : "ok";
  const serviceReady = health.isSuccess && ready.isSuccess;
  const routeLabel =
    location.pathname === "/devices"
      ? "设备"
      : location.pathname.startsWith("/devices/")
        ? "设备详情"
        : location.pathname === "/datasets"
          ? "数据集"
          : location.pathname.startsWith("/datasets/")
            ? "数据集详情"
          : location.pathname === "/exports"
            ? "导出任务"
            : location.pathname === "/workspaces"
              ? "Workspace"
              : location.pathname === "/settings"
                ? "设置"
                : location.pathname === "/dashboard"
                  ? "总览"
                  : "";
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    localStorage.setItem("thcpn:sidebar-collapsed", String(sidebarCollapsed));
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
      {mobileOpen && (
        <button
          type="button"
          className="mobile-drawer-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileOpen ? "open" : ""}`}
        aria-label="主导航"
      >
        <div className="sidebar-brand-row">
          <Brand />
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
        <div className="workspace-switcher">
          <div className="workspace-label">
            <span>当前上下文</span>
          </div>
          {workspace.loading ? (
            <div className="muted" style={{ marginTop: 10, fontSize: 11 }}>
              载入 Workspace…
            </div>
          ) : workspace.workspaces.length ? (
            <select
              className="workspace-select"
              value={workspace.currentId ?? ""}
              onChange={(event) => workspace.setCurrentId(event.target.value)}
            >
              {workspace.workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="muted" style={{ marginTop: 10, fontSize: 11 }}>
              暂无可用 Workspace
            </div>
          )}
        </div>
        <nav style={{ display: "grid", gap: 20 }}>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-title">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
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
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ServiceStatus
            health={serviceStatus(health)}
            ready={serviceStatus(ready)}
            onRefresh={() => {
              void health.refetch();
              void ready.refetch();
            }}
          />
          <div className="account-row">
            <div className="avatar">{(user?.name ?? "U").slice(0, 1)}</div>
            <div className="account-name">
              <div>{user?.name ?? "当前用户"}</div>
              <div className="account-role">
                Workspace 成员
              </div>
            </div>
            <IconButton label="退出登录" onClick={() => void signOut()}>
              <LogOut size={15} />
            </IconButton>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="desktop-sidebar-open">
              <IconButton
                label="展开侧栏"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={18} />
              </IconButton>
            </div>
            <MobileMenuButton onClick={() => setMobileOpen(true)} />
            <div className="topbar-context">
              <span className="mono">THCPN / </span>
              {workspace.current?.name ?? "Workspace 控制台"}
              {routeLabel && (
                <>
                  <span className="breadcrumb-separator">/</span>
                  <strong>{routeLabel}</strong>
                </>
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <Badge
              tone={
                serviceReady
                  ? "success"
                  : health.isLoading || ready.isLoading
                    ? "warning"
                    : "danger"
              }
            >
              <span className="status-dot" />
              {serviceReady
                ? "服务正常"
                : health.isLoading || ready.isLoading
                  ? "检查中"
                  : "服务异常"}
            </Badge>
            <IconButton
              label="账号设置"
              onClick={() => navigate("/settings?tab=security")}
            >
              <CircleUserRound size={18} />
            </IconButton>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Workspaces() {
  const { workspaces, currentId, setCurrentId, loading, error, refresh } =
    useWorkspace();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("lab");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await api.workspaces.create({
        name: name.trim(),
        organization_type: type,
      });
      setMessage(`已创建 ${created.workspace.name}`);
      setName("");
      setShowForm(false);
      await refresh();
      setCurrentId(created.workspace.id);
    } catch (e) {
      const value = formatApiError(e);
      setMessage(
        `${value.message}${value.requestId ? ` · request id ${value.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Workspace / context"
        title="Workspace"
        description="管理你可以访问的组织空间。切换后，设备、数据集和导出查询都会隔离在新的上下文中。"
        actions={
          <Button onClick={() => setShowForm(true)}>
            <Building2 size={15} />
            创建 Workspace
          </Button>
        }
      />
      {message && (
        <div className="command-note" style={{ marginBottom: 16 }}>
          {message}
        </div>
      )}
      {showForm && (
        <Panel style={{ marginBottom: 16 } as React.CSSProperties}>
          <div className="panel-header">
            <h2 className="panel-title">创建组织 Workspace</h2>
            <IconButton label="关闭" onClick={() => setShowForm(false)}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="panel-body form-grid" style={{ maxWidth: 520 }}>
            <label className="field">
              <span className="field-label">Workspace 名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：作物生态课题组"
              />
            </label>
            <label className="field">
              <span className="field-label">组织类型</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="lab">实验室</option>
                <option value="institution">机构</option>
                <option value="company">企业</option>
                <option value="government">政府</option>
                <option value="service_provider">服务商</option>
                <option value="other">其他</option>
              </select>
            </label>
            <div>
              <Button
                onClick={() => void submit()}
                disabled={busy || !name.trim()}
              >
                {busy ? "创建中…" : "确认创建"}
              </Button>
            </div>
          </div>
        </Panel>
      )}
      {loading ? (
        <Panel>
          <StateView
            type="loading"
            title="正在加载 Workspace"
            description="正在从服务端恢复可访问的组织空间。"
          />
        </Panel>
      ) : error ? (
        <Panel>
          <StateView
            type="error"
            title="Workspace 列表加载失败"
            description={formatApiError(error).message}
            requestId={formatApiError(error).requestId}
            action={
              <Button variant="secondary" onClick={refresh}>
                重新加载
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>类型</th>
                  <th>角色</th>
                  <th>成员状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((item) => (
                  <tr
                    key={item.id}
                    className={item.id === currentId ? "selected-row" : ""}
                  >
                    <td>
                      <div className="cell-title">{item.name}</div>
                      <div className="cell-sub mono">{item.id}</div>
                    </td>
                    <td>
                      {item.type === "personal"
                        ? "个人"
                        : (item.organization_type ?? "组织")}
                    </td>
                    <td>
                      <div className="cell-title">
                        {roleTemplateLabel(
                          item.membership.role.code,
                          item.membership.role.name,
                        )}
                      </div>
                      <div className="cell-sub mono">
                        {item.membership.role.code}
                      </div>
                    </td>
                    <td>
                      <Badge
                        tone={
                          item.membership.status === "active"
                            ? "success"
                            : "warning"
                        }
                      >
                        {commonStatusLabel(item.membership.status)}
                      </Badge>
                    </td>
                    <td>
                      {item.id === currentId ? (
                        <Badge tone="info">当前 Workspace</Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => setCurrentId(item.id)}
                        >
                          切换
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!workspaces.length && (
              <StateView
                type="empty"
                title="没有可用 Workspace"
                description="创建一个组织 Workspace，或联系管理员加入现有空间。"
              />
            )}
          </div>
        </Panel>
      )}
    </>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">正在恢复会话…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to="/dashboard" replace />;
}

export function PlatformApp() {
  return (
    <Suspense fallback={<div className="app-loading">正在加载页面…</div>}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage register />} />
        <Route element={<RequirePlatform />}>
          <Route element={<Shell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/workspaces" element={<Workspaces />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route
              path="/devices/:deviceId"
              element={<DeviceCenterDetailPage />}
            />
            <Route path="/device-data" element={<LegacyDeviceDataRedirect />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route
              path="/datasets/:datasetId"
              element={<DatasetDetailPage />}
            />
            <Route path="/exports" element={<ExportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<RootRedirect />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
function RequirePlatform() {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <Outlet />
      </WorkspaceProvider>
    </RequireAuth>
  );
}
