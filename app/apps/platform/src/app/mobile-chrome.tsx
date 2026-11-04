import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLocale } from "@thcpn/i18n";
import { BrandLogo } from "@thcpn/ui";
import { useWorkspace } from "@thcpn/workspace";
import { AlertTriangle, ArrowLeft, Bell, Boxes, Building2, Check, ChevronDown, Gauge, Grid2X2, Layers3 } from "lucide-react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, IconButton, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../shared/ui";
import { mobileParent, mobileSection } from "./mobile-navigation";

const tabs = [
  { section: "overview", to: "/dashboard", label: "platform:navigation.overview", icon: Gauge },
  { section: "devices", to: "/devices", label: "platform:navigation.devices", icon: Boxes },
  { section: "alerts", to: "/alerts", label: "platform:navigation.alerts", icon: AlertTriangle },
  { section: "data", to: "/data", label: "mobile.data", icon: Layers3 },
  { section: "more", to: "/more", label: "mobile.more", icon: Grid2X2 },
] as const;

export function MobileHeader({ title, unread }: { title: string; unread: number }) {
  const { t } = useLocale();
  const workspace = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const parent = mobileParent(location.pathname);
  return <Sheet open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
    <header className="mobile-app-header">
      {parent ? <IconButton label={t("back")} onClick={() => {
        if (window.history.state?.idx > 0) void navigate(-1);
        else void navigate(parent, { replace: true, state: { restoreScroll: true } });
      }}><ArrowLeft size={22} /></IconButton> : <span className="mobile-brand-mark"><BrandLogo /></span>}
      <SheetTrigger asChild><button type="button" className="mobile-context-trigger" aria-label={t("mobile.workspacePicker")}>
        <strong>{title}</strong><span>{workspace.current?.name ?? t("mobile.noWorkspace")}<ChevronDown size={12} aria-hidden="true" /></span>
      </button></SheetTrigger>
      <Link className="mobile-notification" to="/notifications" aria-label={t("mobile.openNotifications")}><Bell size={21} />{unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}</Link>
    </header>
      <SheetContent side="bottom" className="mobile-workspace-sheet">
        <SheetHeader><SheetTitle>{t("mobile.workspacePicker")}</SheetTitle></SheetHeader>
        <Command>
          <CommandInput placeholder={t("mobile.searchWorkspace")} aria-label={t("mobile.searchWorkspace")} />
          <CommandList>
            <CommandEmpty>{t("mobile.noWorkspaceMatch")}</CommandEmpty>
            {workspace.workspaces.map(item => <CommandItem key={item.id} value={item.id} keywords={[item.name]} onSelect={() => {
              if (item.id !== workspace.currentId) workspace.setCurrentId(item.id);
              setWorkspaceOpen(false);
            }} className="mobile-workspace-option"><Building2 size={19} /><span>{item.name}</span>{item.id === workspace.currentId && <Check size={18} aria-label={t("mobile.currentWorkspace")} />}</CommandItem>)}
          </CommandList>
        </Command>
        <Link className="mobile-workspace-manage" to="/workspaces" onClick={() => setWorkspaceOpen(false)}>{t("platform:navigation.workspaces")}</Link>
      </SheetContent>
  </Sheet>;
}

export function MobileNavigation() {
  const { t } = useLocale();
  const { pathname } = useLocation();
  const section = mobileSection(pathname);
  return <nav className="mobile-app-navigation" aria-label={t("mobile.mobileNavigation")}>
    {tabs.map(({ section: key, to, label, icon: Icon }) => <Link key={key} to={to} aria-current={section === key ? "page" : undefined} className={section === key ? "active" : undefined}><Icon size={22} aria-hidden="true" /><span>{t(label)}</span></Link>)}
  </nav>;
}

export function useMobileKeyboard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable);
      const keyboardOpen = editing && viewport.scale === 1 && window.innerHeight - viewport.height > 150;
      setOpen(keyboardOpen);
      const style = document.documentElement.style;
      if (viewport.scale === 1) style.setProperty("--mobile-viewport-height", `${viewport.height}px`);
      else style.removeProperty("--mobile-viewport-height");
      style.setProperty("--mobile-keyboard-inset", `${keyboardOpen ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.documentElement.style.removeProperty("--mobile-viewport-height");
      document.documentElement.style.removeProperty("--mobile-keyboard-inset");
    };
  }, []);
  return open;
}

export function ConnectionStatus() {
  const { t } = useLocale();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online ? null : <div className="mobile-offline-status" role="status">{t("mobile.offline")}</div>;
}
