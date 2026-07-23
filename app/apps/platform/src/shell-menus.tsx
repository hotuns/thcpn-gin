import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Link } from "react-router-dom";
import {
  Check,
  ChevronDown,
  ChevronUp,
  LogOut,
  Search,
  Settings,
  UserPlus,
  UserRound,
} from "lucide-react";
import { type AccessibleWorkspace, type User } from "@thcpn/api";
import { domainLabels, useLocale } from "@thcpn/i18n";

export const canManageWorkspace = (workspace: AccessibleWorkspace | null) =>
  ["owner", "admin"].includes(workspace?.membership.role.code ?? "");

export const filterWorkspaces = (
  workspaces: AccessibleWorkspace[],
  keyword: string,
) => {
  const normalized = keyword.trim().toLocaleLowerCase();
  if (!normalized) return workspaces;
  return workspaces.filter((workspace) =>
    `${workspace.name} ${workspace.id}`.toLocaleLowerCase().includes(normalized),
  );
};

function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  container: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [container, onClose, open]);
}

export function WorkspaceMenu({
  open,
  workspaces,
  current,
  loading,
  onToggle,
  onClose,
  onSwitch,
  onNavigate,
}: {
  open: boolean;
  workspaces: AccessibleWorkspace[];
  current: AccessibleWorkspace | null;
  loading: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSwitch: (workspaceId: string) => void;
  onNavigate: () => void;
}) {
  const { t } = useLocale();
  const labels = domainLabels(t);
  const container = useRef<HTMLDivElement>(null);
  const [keyword, setKeyword] = useState("");
  const filtered = useMemo(
    () => filterWorkspaces(workspaces, keyword),
    [keyword, workspaces],
  );
  usePopoverDismiss(open, onClose, container);
  useEffect(() => {
    if (!open) setKeyword("");
  }, [open]);

  return (
    <div className="workspace-menu-container" ref={container}>
      <button
        type="button"
        className={`workspace-switcher workspace-trigger ${open ? "open" : ""}`}
        aria-expanded={open}
        aria-controls="workspace-switcher-card"
        onClick={onToggle}
      >
        <span className="workspace-trigger-copy">
          <span className="workspace-label">{t("platform:workspace.current")}</span>
          <strong>{loading ? t("platform:workspace.loading") : current?.name ?? t("platform:workspace.none")}</strong>
          {current && (
            <small>
              {labels.role(
                current.membership.role.code,
                current.membership.role.name,
              )}
            </small>
          )}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="sidebar-popover workspace-popover"
          id="workspace-switcher-card"
          role="dialog"
          aria-label={t("platform:workspace.switch")}
        >
          {workspaces.length > 5 && (
            <label className="workspace-search">
              <Search size={14} aria-hidden="true" />
              <input
                autoFocus
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("platform:workspace.search")}
                aria-label={t("platform:workspace.search")}
              />
            </label>
          )}
          <div className="workspace-option-list">
            {filtered.map((workspace) => {
              const selected = workspace.id === current?.id;
              return (
                <button
                  type="button"
                  className={`workspace-option ${selected ? "selected" : ""}`}
                  key={workspace.id}
                  onClick={() => {
                    onSwitch(workspace.id);
                    onClose();
                  }}
                >
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>
                      {labels.role(
                        workspace.membership.role.code,
                        workspace.membership.role.name,
                      )}
                    </small>
                  </span>
                  {selected && <Check size={14} aria-hidden="true" />}
                </button>
              );
            })}
            {!filtered.length && (
              <div className="workspace-search-empty">{t("platform:workspace.noMatch")}</div>
            )}
          </div>
          {canManageWorkspace(current) && (
            <div className="sidebar-popover-actions">
              <Link to="/settings?tab=resources" onClick={onNavigate}>
                <Settings size={15} aria-hidden="true" />
                {t("platform:navigation.settings")}
              </Link>
              <Link
                to="/settings?tab=access&action=invite"
                onClick={onNavigate}
              >
                <UserPlus size={15} aria-hidden="true" />
                {t("platform:workspace.invite")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AccountMenu({
  open,
  user,
  onToggle,
  onClose,
  onNavigate,
  onSignOut,
}: {
  open: boolean;
  user: User | null;
  onToggle: () => void;
  onClose: () => void;
  onNavigate: () => void;
  onSignOut: () => Promise<void>;
}) {
  const { t } = useLocale();
  const container = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, onClose, container);
  return (
    <div className="account-menu-container" ref={container}>
      {open && (
        <div className="sidebar-popover account-popover" role="menu">
          <Link to="/account?tab=profile" role="menuitem" onClick={onNavigate}>
            <UserRound size={15} aria-hidden="true" />
            {t("platform:navigation.account")}
          </Link>
          <Link to="/account?tab=preferences" role="menuitem" onClick={onNavigate}>
            <Settings size={15} aria-hidden="true" />
            {t("preferences")}
          </Link>
          <button
            type="button"
            className="danger"
            role="menuitem"
            onClick={() => void onSignOut()}
          >
            <LogOut size={15} aria-hidden="true" />
            {t("platform:navigation.logout")}
          </button>
        </div>
      )}
      <button
        type="button"
        className={`account-row account-trigger ${open ? "open" : ""}`}
        aria-expanded={open}
        aria-label={t("platform:account.openMenu")}
        onClick={onToggle}
      >
        <span className="avatar">{(user?.name ?? "U").slice(0, 1)}</span>
        <span className="account-name">
          <strong>{user?.name ?? "当前用户"}</strong>
          <small>{user?.email ?? user?.phone ?? "平台账户"}</small>
        </span>
        <ChevronUp size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
