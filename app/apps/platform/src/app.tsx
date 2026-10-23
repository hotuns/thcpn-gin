import { Fragment, lazy, Suspense, useEffect, useState } from "react";
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
  MapPinned,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Table2,
  Workflow,
} from "lucide-react";
import { billingEnabled } from "./features";
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  IconButton,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  PageHeader,
  Panel,
  SelectInput,
  StateView,
  Table,
} from "./platform-ui";
import { AccountMenu, WorkspaceMenu } from "./shell-menus";
import { RequestErrorToasts } from "./request-error-toasts";
import { OnboardingTour } from "./onboarding-tour";
import { platformBreadcrumbs } from "./platform-breadcrumbs";
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
const AtlasPage = lazy(() => import("./atlas-page").then((module) => ({ default: module.AtlasPage })));
const DigitalPlotPage = lazy(() => import("./digital-plot-page").then((module) => ({ default: module.DigitalPlotPage })));
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
const AlertsPage = lazy(() => import("./alerts-page").then((module) => ({ default: module.AlertsPage })));
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
      { to: "/alerts", key: "alerts", icon: AlertTriangle },
    ],
  },
  {
    key: "data",
    items: [
      { to: "/data-compare", key: "compare", icon: BarChart3 },
      { to: "/datasets", key: "datasets", icon: Table2 },
      { to: "/processing", key: "processing", icon: Workflow },
      { to: "/exports", key: "exports", icon: Download },
      { to: "/atlas", key: "wallboards", icon: MapPinned },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("thcpn:sidebar-collapsed") === "true",
  );
  const [activeSidebarMenu, setActiveSidebarMenu] = useState<
    "workspace" | "account" | null
  >(null);
  const { user, signOut } = useAuth();
  const workspace = useWorkspace();
  const location = useLocation();
  const breadcrumbs = platformBreadcrumbs(location.pathname);
  useEffect(() => {
    setMobileOpen(false);
    setActiveSidebarMenu(null);
  }, [location.pathname, location.search]);
  useEffect(() => {
    localStorage.setItem("thcpn:sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 681px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const notificationSummary = useQuery({
    queryKey: workspaceQueryKey(workspace.currentId, "notification-summary"),
    queryFn: async () => {
      const [notices, announcements] = await Promise.all([api.notifications.list(workspace.currentId ?? undefined, 20), api.notifications.announcements(workspace.currentId ?? undefined)]);
      return Number(notices.unread_count ?? 0) + Number(announcements.unread_count ?? 0);
    },
    enabled: Boolean(workspace.currentId),
    refetchInterval: 60_000,
  });
  const sidebarContent = (
    <>
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
        <nav className="sidebar-navigation" aria-label={t("mainNavigation")}>
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
    </>
  );
  return (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-navigation" href="#main-content">{t("platform:shell.skipNavigation")}</a>
      <aside className="sidebar" aria-label={t("mainNavigation")}>{!mobileOpen && sidebarContent}</aside>
      <SheetContent side="left" className="mobile-navigation-sheet">
        <SheetTitle className="sr-only">{t("mainNavigation")}</SheetTitle>
        {sidebarContent}
      </SheetContent>
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
            <SheetTrigger asChild>
              <IconButton className="mobile-menu" label={t("openNavigation")}><Menu size={18} /></IconButton>
            </SheetTrigger>
            <Breadcrumb className="topbar-context">
              <BreadcrumbList>
                {breadcrumbs.map((item,index)=><Fragment key={`${item.key}-${index}`}>{index>0&&<BreadcrumbSeparator/>}<BreadcrumbItem>{item.to?<BreadcrumbLink to={item.to}>{t(`platform:navigation.${item.key}`)}</BreadcrumbLink>:<BreadcrumbPage>{t(`platform:navigation.${item.key}`)}</BreadcrumbPage>}</BreadcrumbItem></Fragment>)}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher compact />
            <IconButton label={t("openGuide")} onClick={() => setOnboardingSession((current) => current + 1)}>
              <HelpCircle size={18} />
            </IconButton>
            <Link className="topbar-notification" to="/notifications" aria-label={t("platform:navigation.notifications")}>
              <Bell size={18} />
              {(notificationSummary.data ?? 0) > 0 && <span>{Math.min(notificationSummary.data ?? 0, 99)}</span>}
            </Link>
          </div>
        </header>
        <main id="main-content" className="page" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {user?.id ? <OnboardingTour key={onboardingSession} userId={user.id} startOpen={onboardingSession > 0} /> : null}
      <RequestErrorToasts />
    </div>
    </Sheet>
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
  const [formError, setFormError] = useState("");
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
    setFormError("");
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
      setFormError(
        `${value.message}${value.requestId ? ` · request id ${value.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={showForm} onOpenChange={(open) => { if (!busy) setShowForm(open); }}>
      <PageHeader
        eyebrow="组织"
        title="组织"
        description="管理你可以访问的组织。切换后，只显示所选组织内的设备、数据集和导出任务。"
        actions={
          <DialogTrigger asChild>
            <Button onClick={() => setFormError("")}>
              <Building2 size={15} />
              创建组织
            </Button>
          </DialogTrigger>
        }
      />
      {message && (
        <div className="command-note" role="status" style={{ marginBottom: 16 }}>
          {message}
        </div>
      )}
        <DialogContent onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>创建组织</DialogTitle>
            <DialogDescription>为课题组或机构建立独立的设备与数据空间，创建后将自动切换到新组织。</DialogDescription>
          </DialogHeader>
          <form className="shadcn-dialog-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={busy}>
            <label className="field">
              <span className="field-label">组织名称</span>
              <Input required disabled={busy} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：作物生态课题组" />
            </label>
            <label className="field">
              <span className="field-label">组织类型</span>
              <SelectInput value={type} onValueChange={setType} disabled={busy} aria-label="组织类型">
                <option value="lab">实验室</option>
                <option value="institution">机构</option>
                <option value="company">企业</option>
                <option value="government">政府</option>
                <option value="service_provider">服务商</option>
                <option value="other">其他</option>
              </SelectInput>
            </label>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setShowForm(false)}>取消</Button>
              <Button type="submit" disabled={busy || !name.trim()}>{busy ? "创建中…" : "创建并切换"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      {loading ? (
        <Panel>
          <StateView
            type="loading"
            title="正在加载组织"
            description="正在从服务端恢复可访问的组织空间。"
          />
        </Panel>
      ) : error ? (
        <Panel>
          <StateView
            type="error"
            title="组织列表加载失败"
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
        <Panel data-onboarding="organization-list">
          <div className="table-wrap">
            <Table className="data-table">
              <thead>
                <tr>
                  <th>组织</th>
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
                          <Badge tone="info">当前组织</Badge>
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
            </Table>
            {!workspaces.length && (
              <StateView
                type="empty"
                title="没有可用组织"
                description="创建一个组织组织，或联系管理员加入现有空间。"
              />
            )}
          </div>
        </Panel>
      )}
    </Dialog>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading t-shimmer" data-text="正在恢复会话…">正在恢复会话…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to="/dashboard" replace />;
}

export function PlatformApp() {
  return (
    <Suspense fallback={<div className="app-loading t-shimmer" data-text="正在加载页面…">正在加载页面…</div>}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/demo-login" element={<Navigate to="/login?demo=1" replace />} />
        <Route path="/register" element={<AuthPage register />} />
        <Route path="/public/devices/:publicSlug" element={<PublicDevicePage />} />
        <Route element={<RequirePlatform />}>
          <Route element={<Shell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/workspaces" element={<Workspaces />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/device-map" element={<DeviceMapPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
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
            <Route path="/exports" element={<ExportsPage key="export-list" />} />
            <Route path="/exports/new" element={<ExportsPage key="export-create" creating />} />
            <Route path="/processing" element={<ProcessingPage />} />
            <Route path="/processing/:taskId" element={<ProcessingTaskDetailPage />} />
            <Route path="/atlas" element={<AtlasPage />} />
            <Route path="/atlas/topics/digital-plot" element={<DigitalPlotPage />} />
            <Route path="/atlas/:id" element={<AtlasPage />} />
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
