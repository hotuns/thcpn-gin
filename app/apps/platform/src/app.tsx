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
  useSearchParams,
} from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CreditCard,
  Download,
  Gauge,
  HelpCircle,
  Home,
  MapPinned,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Table2,
  Truck,
  Workflow,
  X,
} from "lucide-react";
import { billingEnabled } from "./features";
import {
  api,
  apiErrorEvent,
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
  StateView,
} from "@thcpn/ui";
import { AccountMenu, WorkspaceMenu } from "./shell-menus";
import { OnboardingTour } from "./onboarding-tour";
import { LanguageSwitcher, useLocale } from "@thcpn/i18n";
const DevicesPage = lazy(() =>
  import("./devices-page").then((module) => ({ default: module.DevicesPage })),
);
const DeviceClaimPage = lazy(() =>
  import("./device-claim-page").then((module) => ({ default: module.DeviceClaimPage })),
);
const DeviceMapPage = lazy(() => import("./device-map-page").then((module) => ({ default: module.DeviceMapPage })));
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
const DatasetEditorPage = lazy(() =>
  import("./datasets-page").then((module) => ({
    default: module.DatasetEditorPage,
  })),
);
const ExportsPage = lazy(() =>
  import("./exports-page").then((module) => ({ default: module.ExportsPage })),
);
const ProcessingPage = lazy(() => import("./processing-page").then((module) => ({ default: module.ProcessingPage })));
const ProcessingTaskDetailPage = lazy(() => import("./processing-page").then((module) => ({ default: module.ProcessingTaskDetailPage })));
const DataComparisonPage = lazy(() =>
  import("./data-comparison-page").then((module) => ({
    default: module.DataComparisonPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./settings").then((module) => ({ default: module.SettingsPage })),
);
const SubscriptionPage = lazy(() =>
  import("./subscription-page").then((module) => ({ default: module.SubscriptionPage })),
);
const NotificationsPage = lazy(() =>
  import("./notifications-page").then((module) => ({ default: module.NotificationsPage })),
);
const AccountPage = lazy(() =>
  import("./account-page").then((module) => ({ default: module.AccountPage })),
);
const AuthPage = lazy(() =>
  import("./auth-pages").then((module) => ({ default: module.AuthPage })),
);
const DashboardPage = lazy(() =>
  import("./dashboard-page").then((module) => ({
    default: module.DashboardPage,
  })),
);
const PublicDevicePage = lazy(() =>
  import("./public-device-page").then((module) => ({ default: module.PublicDevicePage })),
);

const navGroups = [
  {
    key: "operations",
    items: [
      { to: "/dashboard", key: "overview", icon: Gauge },
      { to: "/devices", key: "devices", icon: Boxes },
      { to: "/device-map", key: "deviceMap", icon: MapPinned },
    ],
  },
  {
    key: "data",
    items: [
      { to: "/data-compare", key: "compare", icon: BarChart3 },
      { to: "/datasets", key: "datasets", icon: Table2 },
      { to: "/processing", key: "processing", icon: Workflow },
      { to: "/exports", key: "exports", icon: Download },
    ],
  },
  {
    key: "management",
    items: [
      { to: "/workspaces", key: "workspaces", icon: Building2 },
      ...(billingEnabled
        ? [{ to: "/subscription", key: "subscription", icon: CreditCard }]
        : []),
    ],
  },
];

function Shell() {
  const { t } = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [onboardingSession, setOnboardingSession] = useState(0);
  const [requestError, setRequestError] = useState<ReturnType<typeof formatApiError> | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("thcpn:sidebar-collapsed") === "true",
  );
  const [activeSidebarMenu, setActiveSidebarMenu] = useState<
    "workspace" | "account" | null
  >(null);
  const { user, signOut } = useAuth();
  const workspace = useWorkspace();
  const location = useLocation();
  const routeLabel =
    location.pathname === "/device-map"
      ? t("platform:navigation.deviceMap")
      : location.pathname === "/devices"
      ? t("platform:navigation.devices")
      : location.pathname.startsWith("/devices/")
        ? t("platform:navigation.deviceDetails")
      : location.pathname === "/datasets"
          ? t("platform:navigation.datasets")
          : location.pathname === "/datasets/new"
            ? t("platform:navigation.createDataset")
            : location.pathname.endsWith("/edit")
              ? t("platform:navigation.editDataset")
              : location.pathname.startsWith("/datasets/")
                ? t("platform:navigation.datasetDetails")
          : location.pathname === "/data-compare"
            ? t("platform:navigation.compare")
          : location.pathname === "/exports"
            ? t("platform:navigation.exports")
          : location.pathname.startsWith("/processing")
            ? t("platform:navigation.processing")
            : location.pathname === "/workspaces"
              ? t("platform:navigation.workspaces")
            : location.pathname === "/settings"
                ? t("platform:navigation.settings")
                : location.pathname === "/subscription"
                  ? t("platform:navigation.subscription")
                : location.pathname === "/notifications"
                  ? t("platform:navigation.notifications")
                : location.pathname === "/account"
                  ? t("platform:navigation.account")
                : location.pathname === "/dashboard"
                  ? t("platform:navigation.overview")
                  : "";
  useEffect(() => {
    setMobileOpen(false);
    setActiveSidebarMenu(null);
  }, [location.pathname, location.search]);
  useEffect(() => {
    localStorage.setItem("thcpn:sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    const showRequestError = (event: Event) => {
      setRequestError(formatApiError((event as CustomEvent).detail));
    };
    window.addEventListener(apiErrorEvent, showRequestError);
    return () => window.removeEventListener(apiErrorEvent, showRequestError);
  }, []);
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
  const notificationSummary = useQuery({
    queryKey: workspaceQueryKey(workspace.currentId, "notification-summary"),
    queryFn: async () => {
      const [notices, announcements] = await Promise.all([api.notifications.list(workspace.currentId ?? undefined, 20), api.notifications.announcements(workspace.currentId ?? undefined)]);
      return Number(notices.unread_count ?? 0) + Number(announcements.unread_count ?? 0);
    },
    enabled: Boolean(workspace.currentId),
    refetchInterval: 60_000,
  });
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && (
        <button
          type="button"
          className="mobile-drawer-backdrop"
          aria-label={t("closeNavigation")}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileOpen ? "open" : ""}`}
        aria-label={t("mainNavigation")}
      >
        <div className="sidebar-brand-row">
          <Brand />
          <div className="desktop-sidebar-toggle">
            <IconButton
              label={sidebarCollapsed ? t("openNavigation") : t("closeNavigation")}
              onClick={() => setSidebarCollapsed((current) => !current)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </IconButton>
          </div>
          <div className="mobile-close">
            <CloseButton onClick={() => setMobileOpen(false)} />
          </div>
        </div>
        <WorkspaceMenu
          open={activeSidebarMenu === "workspace"}
          workspaces={workspace.workspaces}
          current={workspace.current}
          loading={workspace.loading}
          onToggle={() =>
            setActiveSidebarMenu((current) =>
              current === "workspace" ? null : "workspace",
            )
          }
          onClose={() => setActiveSidebarMenu(null)}
          onSwitch={workspace.setCurrentId}
          onNavigate={() => {
            setActiveSidebarMenu(null);
            setMobileOpen(false);
          }}
        />
        <nav style={{ display: "grid", gap: 20 }}>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.key}>
              <div className="nav-title">{t(`platform:navigationGroups.${group.key}`)}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    data-onboarding={item.key}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `nav-item ${isActive ? "active" : ""}`
                    }
                    title={t(`platform:navigation.${item.key}`)}
                  >
                    <Icon size={16} />
                    <span>{t(`platform:navigation.${item.key}`)}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <AccountMenu
            open={activeSidebarMenu === "account"}
            user={user}
            onToggle={() =>
              setActiveSidebarMenu((current) =>
                current === "account" ? null : "account",
              )
            }
            onClose={() => setActiveSidebarMenu(null)}
            onNavigate={() => {
              setActiveSidebarMenu(null);
              setMobileOpen(false);
            }}
            onSignOut={async () => {
              setActiveSidebarMenu(null);
              setMobileOpen(false);
              await signOut();
            }}
          />
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="desktop-sidebar-open">
              <IconButton
                label={t("openNavigation")}
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={18} />
              </IconButton>
            </div>
            <MobileMenuButton onClick={() => setMobileOpen(true)} />
            <div className="topbar-context">
              <span className="mono">{t("platform:brand")} / </span>
              {workspace.current?.name ?? t("platform:navigation.workspaces")}
              {routeLabel && (
                <>
                  <span className="breadcrumb-separator">/</span>
                  <strong>{routeLabel}</strong>
                </>
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher compact />
            <IconButton label="打开使用引导" onClick={() => setOnboardingSession((current) => current + 1)}>
              <HelpCircle size={18} />
            </IconButton>
            <Link className="topbar-notification" to="/notifications" aria-label={t("platform:navigation.notifications")}>
              <Bell size={18} />
              {(notificationSummary.data ?? 0) > 0 && <span>{Math.min(notificationSummary.data ?? 0, 99)}</span>}
            </Link>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
      {user?.id ? <OnboardingTour key={onboardingSession} userId={user.id} startOpen={onboardingSession > 0} /> : null}
      {requestError ? (
        <section className="global-request-error" role="alert" aria-live="assertive">
          <AlertTriangle size={22} />
          <div>
            <strong>{requestError.status === 401 ? t("errors.unauthorized") : requestError.status === 403 ? t("errors.permission_denied") : t("requestFailed")}</strong>
            <p>{requestError.message}</p>
            {requestError.requestId ? <small>{t("requestId", { id: requestError.requestId })}</small> : null}
          </div>
          <CloseButton onClick={() => setRequestError(null)} />
        </section>
      ) : null}
    </div>
  );
}

function Workspaces() {
  const { workspaces, currentId, setCurrentId, loading, error, refresh } =
    useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [showForm, setShowForm] = useState(params.get("action") === "create");
  const [name, setName] = useState("");
  const [type, setType] = useState("lab");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (params.get("action") !== "create") return;
    setShowForm(true);
    const next = new URLSearchParams(params);
    next.delete("action");
    setParams(next, { replace: true });
  }, [params, setParams]);
  const manageWorkspace = (workspaceId: string) => {
    if (workspaceId !== currentId) setCurrentId(workspaceId);
    navigate("/settings?tab=resources");
  };
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
        eyebrow="工作区"
        title="工作区"
        description="管理你可以访问的工作区。切换后，只显示所选工作区内的设备、数据集和导出任务。"
        actions={
          <Button onClick={() => setShowForm(true)}>
            <Building2 size={15} />
            创建工作区
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
            <h2 className="panel-title">创建组织工作区</h2>
            <IconButton label="关闭" onClick={() => setShowForm(false)}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="panel-body form-grid" style={{ maxWidth: 520 }}>
            <label className="field">
              <span className="field-label">工作区名称</span>
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
            title="正在加载工作区"
            description="正在从服务端恢复可访问的组织空间。"
          />
        </Panel>
      ) : error ? (
        <Panel>
          <StateView
            type="error"
            title="工作区列表加载失败"
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
                  <th>工作区</th>
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
                      <div className="workspace-list-actions">
                        {item.id === currentId ? (
                          <Badge tone="info">当前工作区</Badge>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => setCurrentId(item.id)}
                          >
                            切换
                          </Button>
                        )}
                        <Button onClick={() => manageWorkspace(item.id)}>
                          <SlidersHorizontal size={14} />
                          管理
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!workspaces.length && (
              <StateView
                type="empty"
                title="没有可用工作区"
                description="创建一个组织工作区，或联系管理员加入现有空间。"
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
        <Route path="/public/devices/:publicSlug" element={<PublicDevicePage />} />
        <Route element={<RequirePlatform />}>
          <Route element={<Shell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/workspaces" element={<Workspaces />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/device-map" element={<DeviceMapPage />} />
            <Route path="/claim" element={<DeviceClaimPage />} />
            <Route path="/claim/:claimSlug" element={<DeviceClaimPage />} />
            <Route
              path="/devices/:deviceId"
              element={<DeviceCenterDetailPage />}
            />
            <Route path="/device-data" element={<LegacyDeviceDataRedirect />} />
            <Route path="/data-compare" element={<DataComparisonPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/datasets/new" element={<DatasetEditorPage />} />
            <Route
              path="/datasets/:datasetId/edit"
              element={<DatasetEditorPage />}
            />
            <Route
              path="/datasets/:datasetId"
              element={<DatasetDetailPage />}
            />
            <Route path="/exports" element={<ExportsPage />} />
            <Route path="/processing" element={<ProcessingPage />} />
            <Route path="/processing/:taskId" element={<ProcessingTaskDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {billingEnabled ? (
              <Route path="/subscription" element={<SubscriptionPage />} />
            ) : null}
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/account" element={<AccountPage />} />
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
