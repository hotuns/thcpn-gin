import { Drawer } from "antd";
import { useEffect, type ReactNode, type RefObject } from "react";
import { useLocale } from "@thcpn/i18n";
import { useAdminMobile } from "./admin-mobile";

export function AdminNavigation({ children, open, onClose, onClosed, routeKey, triggerRef, mainRef }: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  onClosed?: () => void;
  routeKey: string;
  triggerRef: RefObject<HTMLDivElement | null>;
  mainRef: RefObject<HTMLElement | null>;
}) {
  const mobile = useAdminMobile();
  const { t } = useLocale();
  useEffect(() => { onClose(); }, [routeKey, onClose]);
  useEffect(() => {
    if (!mobile && open) {
      onClose();
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [mobile, open, onClose, mainRef]);
  useEffect(() => { if (!mobile) onClosed?.(); }, [mobile, onClosed]);
  if (!mobile) return <aside className="sidebar admin-sidebar" aria-label={t("admin:title")}>{children}</aside>;
  return <Drawer
    rootClassName="admin-navigation-drawer"
    title={t("admin:title")}
    placement="left"
    size="min(320px, calc(100vw - 32px))"
    open={open}
    onClose={onClose}
    destroyOnHidden
    afterOpenChange={visible => {
      if (!visible) {
        triggerRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        onClosed?.();
      }
    }}
  ><nav id="admin-mobile-navigation" className="sidebar admin-sidebar" aria-label={t("admin:title")}>{children}</nav></Drawer>;
}
