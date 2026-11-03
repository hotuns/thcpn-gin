import { useQuery } from "@tanstack/react-query";
import {
  api
} from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { LanguageSwitcher, useLocale } from "@thcpn/i18n";
import {
  useWorkspace,
  workspaceQueryKey
} from "@thcpn/workspace";
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
  PanelLeftClose,
  PanelLeftOpen,
  Table2,
  Workflow
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation
} from "react-router-dom";
import { useSystemPolicy } from "../shared/config/system-policy";
import {
  Brand,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  IconButton
} from "../shared/ui";
import { OnboardingTour } from "./onboarding-tour";
import { platformBreadcrumbs } from "./platform-breadcrumbs";
import { RequestErrorToasts } from "./request-error-toasts";
import { AccountMenu, WorkspaceMenu } from "./shell-menus";
import { useIsMobile } from "../shared/hooks/use-mobile";
import { ConnectionStatus, MobileHeader, MobileNavigation, useMobileKeyboard } from "./mobile-chrome";
import { mobileEditor, mobileWorkbench } from "./mobile-navigation";
import { useRouteScroll } from "./use-route-scroll";



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
      { to: "/subscription", key: "subscription", icon: CreditCard },
    ],
  },
];

export function Shell() {
 const billingEnabled=useSystemPolicy().data?.billing_enabled;
  const { t } = useLocale();
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
  const isMobile = useIsMobile();
  const keyboardOpen = useMobileKeyboard();
  const focusedPage = mobileEditor(location.pathname) || mobileWorkbench(location.pathname);
  const mobileTitle = location.pathname === "/data" ? t("mobile.data") : location.pathname === "/more" ? t("mobile.more") : t(`platform:navigation.${breadcrumbs.at(-1)?.key ?? "overview"}`);
  useRouteScroll(workspace.currentId);
  useEffect(() => {
    setActiveSidebarMenu(null);
  }, [location.pathname, location.search]);
  useEffect(() => {
    localStorage.setItem("thcpn:sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
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
          onNavigate={() => setActiveSidebarMenu(null)}
        />
        <nav className="sidebar-navigation" aria-label={t("mainNavigation")}>
          {navGroups.map(group=>({...group,items:group.items.filter(item=>item.key!=="subscription"||billingEnabled)})).map((group) => (
            <div className="nav-group" key={group.key}>
              <div className="nav-title">{t(`platform:navigationGroups.${group.key}`)}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    data-onboarding={item.key}
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
            onNavigate={() => setActiveSidebarMenu(null)}
            onSignOut={async () => {
              setActiveSidebarMenu(null);
              await signOut();
            }}
          />
        </div>
    </>
  );
  return (
    <div className={`app-shell platform-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${focusedPage ? "mobile-focused-page" : ""}`} data-keyboard-open={keyboardOpen || undefined}>
      <a className="skip-navigation" href="#main-content">{t("platform:shell.skipNavigation")}</a>
      {!isMobile && <aside className="sidebar" aria-label={t("mainNavigation")}>{sidebarContent}</aside>}
      <div className="main-area">
        {isMobile ? <MobileHeader title={mobileTitle} unread={notificationSummary.data ?? 0} /> : <header className="topbar">
          <div className="topbar-left">
            <div className="desktop-sidebar-open">
              <IconButton
                label={t("openNavigation")}
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={18} />
              </IconButton>
            </div>
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
        </header>}
        <ConnectionStatus />
        <main id="main-content" className="page" tabIndex={-1}>
          <Outlet context={{ openGuide: () => setOnboardingSession(current => current + 1) }} />
        </main>
      </div>
      {isMobile && !focusedPage && !keyboardOpen && <MobileNavigation />}
      {user?.id ? <OnboardingTour key={onboardingSession} userId={user.id} startOpen={onboardingSession > 0} /> : null}
      <RequestErrorToasts />
    </div>
  );
}
