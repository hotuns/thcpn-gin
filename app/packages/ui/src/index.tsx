import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { AlertTriangle, Check, Copy, Database, FileWarning, Inbox, Menu, RefreshCw, Server, ShieldAlert, X } from "lucide-react";
import { cn } from "./utils";
import { useLocale } from "@thcpn/i18n";

export { cn } from "./utils";

export function Button({ variant = "primary", className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={cn("btn", `btn-${variant}`, className)} {...props}>{children}</button>;
}

export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button aria-label={label} title={label} className={cn("icon-btn", className)} {...props}>{children}</button>;
}

export function Badge({ tone = "neutral", children }: { tone?: "success" | "info" | "warning" | "danger" | "neutral"; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Panel({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return <section className={cn("panel", className)} style={style}>{children}</section>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</div>;
}

export function StateView({ type, title, description, action, requestId }: { type: "empty" | "error" | "loading"; title: string; description: string; action?: ReactNode; requestId?: string }) {
  const { t } = useLocale();
  const Icon = type === "empty" ? Inbox : type === "error" ? FileWarning : RefreshCw;
  return <div className={`${type}-state`}><div className="state-icon"><Icon size={18} className={type === "loading" ? "spin" : undefined} /></div><h3 className="state-title">{title}</h3><p className="state-copy">{description}</p>{requestId && <div className="error-detail">{t("requestId", { id: requestId })}</div>}{action && <div style={{ marginTop: 16 }}>{action}</div>}</div>;
}

export function ServiceStatus({ health, ready, onRefresh }: { health: "ok" | "error" | "loading"; ready: "ok" | "error" | "loading"; onRefresh: () => void }) {
  const status = (value: string) => value === "ok" ? <span className="status-value"><span className="status-dot" />正常</span> : value === "loading" ? <span className="status-value warning"><RefreshCw size={12} className="spin" />检查中</span> : <span className="status-value warning"><span className="status-dot" />异常</span>;
  return <div className="status-strip"><div className="status-line"><span>API health</span>{status(health)}</div><div className="status-line"><span>Dependencies</span>{status(ready)}</div><IconButton label="刷新服务状态" onClick={onRefresh} className="status-refresh"><RefreshCw size={13} /></IconButton></div>;
}

export function CopyId({ value }: { value: string }) {
  const { t } = useLocale();
  const copy = async () => { await navigator.clipboard?.writeText(value); };
  return <button className="mono" onClick={copy} title={t("copyId")} style={{ color: "var(--blue)", background: "none", border: 0, padding: 0 }}>{value.slice(0, 8)}… <Copy size={11} style={{ verticalAlign: "-2px" }} /></button>;
}

export function Brand({ admin = false }: { admin?: boolean }) {
  return <div className="brand"><div className="brand-mark"><Database size={17} /></div><div><div className="brand-name">THCPN</div><div className="brand-sub">{admin ? "SYSTEM CONTROL" : "RESEARCH NETWORK"}</div></div></div>;
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) { const { t } = useLocale(); return <IconButton label={t("openNavigation")} className="mobile-menu" onClick={onClick}><Menu size={18} /></IconButton>; }
export function CloseButton({ onClick }: { onClick: () => void }) { const { t } = useLocale(); return <IconButton label={t("closeNavigation")} onClick={onClick}><X size={18} /></IconButton>; }
export function PermissionIcon() { return <ShieldAlert size={18} />; }
export function WarningIcon() { return <AlertTriangle size={18} />; }
export function SuccessIcon() { return <Check size={18} />; }
