import { useQuery } from "@tanstack/react-query";
import { api } from "@thcpn/api";
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
  HelpCircle,
  MapPinned,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  ScanLine,
  Settings,
  Table2,
  Workflow
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Link,
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
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../shared/ui";
import { OnboardingTour } from "./onboarding-tour";
import { findPlatformRoute, platformBreadcrumbs } from "./platform-routes";
import { restoreScroll, useNavigationSource, usePlatformReturn, type PlatformOutletContext } from "./platform-navigation";
import { RequestErrorToasts } from "./request-error-toasts";
import { AccountMenu, WorkspaceMenu } from "./shell-menus";
import { useIsMobile } from "../shared/hooks/use-mobile";
import { ConnectionStatus, MobileHeader, MobileNavigation, useMobileKeyboard } from "./mobile-chrome";
import { useRouteScroll } from "./use-route-scroll";
import { platformEdition } from "./edition";
const fullNavGroups = [
  {
    key: "operations",
    items: [
      { to: "/dashboard", key: "overview", icon: Radar },
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
      { to: "/atlas", key: "wallboards", icon: ScanLine },
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
const liteNavGroups = [
  {
    key: "operations",
    items: [
      { to: "/atlas", key: "wallboards", icon: ScanLine },
      { to: "/devices", key: "devices", icon: Boxes },
      { to: "/device-map", key: "deviceMap", icon: MapPinned },
    ],
  },
  {
    key: "data",
    items: [
      { to: "/exports", key: "exports", icon: Download },
    ],
  },
  {
    key: "management",
    items: [
      { to: "/settings", key: "settings", icon: Settings },
    ],
  },
];
const navGroups = (platformEdition.lite ? liteNavGroups : fullNavGroups)
  .map((group) => ({
    ...group,
    items: group.items.filter((item) => platformEdition.allowedNavKeys.has(item.key)),
  }))
  .filter((group) => group.items.length > 0);
const sidebarKeys = new Set(navGroups.flatMap(group => group.items.map(item => item.key)));

export function Shell() {
  const billingEnabled = useSystemPolicy().data?.billing_enabled;
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
  const exitEditorForWorkspace = useRef<(() => boolean) | null>(null);
  const switchWorkspace = (nextId: string) => {
    if (nextId === workspace.currentId) return true;
    if (exitEditorForWorkspace.current && !exitEditorForWorkspace.current()) return false;
    workspace.setCurrentId(nextId);
    return true;
  };
  const location = useLocation();
  const route = findPlatformRoute(location.pathname);
  const returnLink = usePlatformReturn();
  const source = useNavigationSource();
  const breadcrumbs = platformBreadcrumbs(location.pathname);
  const immersive = route?.presentation === "immersive";
  const sidebarKey = route?.key === "notifications" ? undefined : breadcrumbs.slice().reverse().find(item => sidebarKeys.has(item.key))?.key;
  const isMobile = useIsMobile();
  const keyboardOpen = useMobileKeyboard();
  const focusedPage = Boolean(route?.editor || route?.presentation);
  const mobileTitle = route?.key === "dataHub"
    ? t("mobile.data")
    : platformEdition.settingsResourcesOnly && route?.key === "settings"
      ? "项目与样地"
      : t(`platform:navigation.${route?.key ?? "overview"}`);
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
    enabled: platformEdition.showNotifications && Boolean(workspace.currentId),
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
              aria-expanded={!sidebarCollapsed}
              aria-controls="platform-sidebar-navigation"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </IconButton>
          </div>
        </div>
        {platformEdition.showWorkspaceSwitcher && (
          <WorkspaceMenu
            open={activeSidebarMenu === "workspace"}
            collapsed={sidebarCollapsed}
            workspaces={workspace.workspaces}
            current={workspace.current}
            loading={workspace.loading}
            onToggle={() =>
              setActiveSidebarMenu((current) =>
                current === "workspace" ? null : "workspace",
              )
            }
            onClose={() => setActiveSidebarMenu(null)}
            onSwitch={switchWorkspace}
            onNavigate={() => setActiveSidebarMenu(null)}
          />
        )}
        <nav id="platform-sidebar-navigation" className="sidebar-navigation" aria-label={t("mainNavigation")}>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.key}>
              <div className="nav-title">{t(`platform:navigationGroups.${group.key}`)}</div>
              {group.items.filter((item) => item.key !== "subscription" || billingEnabled).map((item) => {
                const Icon = item.icon;
                const label = platformEdition.settingsResourcesOnly && item.key === "settings"
                  ? "项目与样地"
                  : t(`platform:navigation.${item.key}`);
                const active = item.key === sidebarKey;
                const navLink = (
                  <Link
                    key={item.to}
                    to={item.to}
                    data-onboarding={item.key}
                    className={`nav-item ${active ? "active" : ""}`}
                    aria-current={active ? (item.key === route?.key ? "page" : "location") : undefined}
                    aria-label={label}
                    title={sidebarCollapsed ? undefined : label}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                );
                if (!sidebarCollapsed) return navLink;
                return (
                  <Tooltip key={item.to}>
                    <TooltipTrigger asChild>{navLink}</TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <AccountMenu
            open={activeSidebarMenu === "account"}
            collapsed={sidebarCollapsed}
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
      {!isMobile && <aside className="sidebar platform-sidebar" aria-label={t("mainNavigation")}>{sidebarContent}</aside>}
      <div className="main-area">
        {isMobile ? <MobileHeader title={mobileTitle} unread={notificationSummary.data ?? 0} returnLink={immersive ? undefined : returnLink} onSwitchWorkspace={switchWorkspace} /> : <header className="topbar">
          <div className="topbar-left">
            <Breadcrumb className="topbar-context">
              <BreadcrumbList>
                {breadcrumbs.map((item, index) => {
                  const isParent = index === breadcrumbs.length - 2;
                  const key = isParent ? returnLink.key ?? item.key : item.key;
                  const label = platformEdition.settingsResourcesOnly && key === "settings"
                    ? "项目与样地"
                    : t(`platform:navigation.${key}`);
                  const to = isParent ? returnLink.target : item.to;
                  return <Fragment key={`${item.key}-${index}`}>
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {to && !immersive ? (
                        <BreadcrumbLink to={to} state={restoreScroll} onClick={event => {
                          if (!isParent || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                          event.preventDefault();
                          returnLink.back();
                        }}>{label}</BreadcrumbLink>
                      ) : item.to ? <span>{label}</span> : <BreadcrumbPage>{label}</BreadcrumbPage>}
                    </BreadcrumbItem>
                  </Fragment>;
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher compact />
            {platformEdition.showOnboarding && (
              <IconButton label={t("openGuide")} onClick={() => setOnboardingSession((current) => current + 1)}>
                <HelpCircle size={18} />
              </IconButton>
            )}
            {platformEdition.showNotifications && (
              <Link className="topbar-notification" to="/notifications" replace={route?.key === "notifications"} state={route?.key === "notifications" ? location.state : source} aria-label={t("platform:navigation.notifications")}>
                <Bell size={18} />
                {(notificationSummary.data ?? 0) > 0 && <span>{Math.min(notificationSummary.data ?? 0, 99)}</span>}
              </Link>
            )}
          </div>
        </header>}
        <ConnectionStatus />
        <main id="main-content" className="page" tabIndex={-1}>
          <Outlet context={{ openGuide: () => setOnboardingSession(current => current + 1), exitEditorForWorkspace } satisfies PlatformOutletContext} />
        </main>
      </div>
      {isMobile && !focusedPage && !keyboardOpen && <MobileNavigation />}
      {platformEdition.showOnboarding && user?.id ? <OnboardingTour key={onboardingSession} userId={user.id} startOpen={onboardingSession > 0} /> : null}
      <RequestErrorToasts />
    </div>
  );
}
