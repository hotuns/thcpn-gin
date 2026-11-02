import { Link } from "react-router-dom";
import {
  Check,
  Building2,
  ChevronsUpDown,
  ChevronUp,
  LogOut,
  Settings,
  UserPlus,
  UserRound,
} from "lucide-react";
import { type AccessibleWorkspace, type User } from "@thcpn/api";
import { domainLabels, useLocale } from "@thcpn/i18n";
import { Button } from "./components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";

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

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      if (nextOpen === open) return;
      if (nextOpen) onToggle();
      else onClose();
    }}>
      <div className="workspace-menu-container">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="workspace-switcher workspace-trigger"
            aria-label={`${t("platform:workspace.switch")}：${current?.name ?? t("platform:workspace.none")}`}
            disabled={loading}
          >
            <Building2 className="workspace-trigger-icon" size={18} aria-hidden="true" />
            <span className="workspace-trigger-copy">
              <span className="workspace-label">{t("platform:workspace.current")}</span>
              <strong>{loading ? t("platform:workspace.loading") : current?.name ?? t("platform:workspace.none")}</strong>
              {current && <small>{labels.role(current.membership.role.code, current.membership.role.name)}</small>}
            </span>
            <ChevronsUpDown size={15} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="workspace-command-popover" align="start" aria-label={t("platform:workspace.switch")}>
          <Command filter={(value, search, keywords) => `${value} ${(keywords ?? []).join(" ")}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ? 1 : 0}>
            <CommandInput placeholder={t("platform:workspace.search")} aria-label={t("platform:workspace.search")} />
            <CommandList>
              <CommandEmpty>{t("platform:workspace.noMatch")}</CommandEmpty>
              <CommandGroup heading={t("platform:workspace.switch")}>
                {workspaces.map((workspace) => (
                  <CommandItem
                    key={workspace.id}
                    value={workspace.id}
                    keywords={[workspace.name]}
                    className="workspace-command-option"
                    onSelect={() => {
                      if (workspace.id !== current?.id) onSwitch(workspace.id);
                      onClose();
                    }}
                  >
                    <Building2 size={16} aria-hidden="true" />
                    <span>
                      <strong>{workspace.name}</strong>
                      <small>{labels.role(workspace.membership.role.code, workspace.membership.role.name)}</small>
                    </span>
                    {workspace.id === current?.id && <Check size={16} aria-label={t("platform:workspace.current")} />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          {canManageWorkspace(current) && (
            <div className="workspace-command-actions">
              <CommandSeparator />
              <Button variant="ghost" asChild>
                <Link to="/settings?tab=resources" onClick={onNavigate}>
                  <Settings size={15} aria-hidden="true" />
                  {t("platform:navigation.settings")}
                </Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/settings?tab=access" onClick={onNavigate}>
                  <UserPlus size={15} aria-hidden="true" />
                  {t("platform:workspace.invite")}
                </Link>
              </Button>
            </div>
          )}
          </Command>
        </PopoverContent>
      </div>
    </Popover>
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
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen === open) return;
        if (nextOpen) onToggle();
        else onClose();
      }}
    >
      <div className="account-menu-container">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={`account-row account-trigger ${open ? "open" : ""}`}
            aria-label={t("platform:account.openMenu")}
          >
            <span className="avatar">{(user?.name ?? "U").slice(0, 1)}</span>
            <span className="account-name">
              <strong>{user?.name ?? t("platform:account.currentUser")}</strong>
              <small>{user?.email ?? user?.phone ?? t("platform:account.platformAccount")}</small>
            </span>
            <ChevronUp size={15} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="account-dropdown-content" side="top" align="start">
          <DropdownMenuItem asChild>
            <Link to="/account?tab=profile" onClick={onNavigate}>
              <UserRound size={15} aria-hidden="true" />
              {t("platform:navigation.account")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/account?tab=preferences" onClick={onNavigate}>
              <Settings size={15} aria-hidden="true" />
              {t("preferences")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="danger" onSelect={() => void onSignOut()}>
            <LogOut size={15} aria-hidden="true" />
            {t("platform:navigation.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
  );
}
