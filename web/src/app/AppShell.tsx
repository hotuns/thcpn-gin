import { useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  ChevronDown,
  Database,
  FileArchive,
  Fingerprint,
  FolderKanban,
  Gauge,
  HardDrive,
  History,
  KeyRound,
  Layers3,
  LogOut,
  Menu,
  RadioTower,
  ShieldCheck,
  SquareStack,
  Users,
  X
} from "lucide-react";
import { authApi, formatApiError, statusApi } from "../api";
import { Badge, Button, ErrorState, LoadingState, statusTone, useToast } from "../components";
import { useAuth } from "./AuthProvider";
import { useWorkspace } from "./WorkspaceProvider";
import { formatDateTime } from "./format";

const navGroups = [
  {
    label: "运行",
    items: [
      { to: "/dashboard", label: "总览", icon: Gauge },
      { to: "/projects", label: "项目", icon: FolderKanban },
      { to: "/sites", label: "站点", icon: RadioTower },
      { to: "/devices", label: "设备", icon: HardDrive },
      { to: "/data-streams", label: "数据流", icon: Activity }
    ]
  },
  {
    label: "数据",
    items: [
      { to: "/data-sources", label: "数据源", icon: Database },
      { to: "/datasets", label: "数据集", icon: SquareStack },
      { to: "/export-jobs", label: "导出", icon: FileArchive }
    ]
  },
  {
    label: "治理",
    items: [
      { to: "/workspaces", label: "工作区", icon: Boxes },
      { to: "/members", label: "成员", icon: Users },
      { to: "/access-grants", label: "授权", icon: KeyRound },
      { to: "/invitations", label: "邀请", icon: Fingerprint },
      { to: "/audit-logs", label: "审计", icon: History },
      { to: "/security", label: "安全", icon: ShieldCheck }
    ]
  }
];

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaces = useWorkspace();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const healthQuery = useQuery({
    queryKey: ["service-status"],
    queryFn: async () => {
      const [healthz, readyz] = await Promise.all([statusApi.healthz(), statusApi.readyz()]);
      return { healthz, readyz, checkedAt: new Date().toISOString() };
    },
    refetchInterval: 60_000
  });

  const selectedRole = workspaces.selectedWorkspace?.membership.role.name || workspaces.selectedWorkspace?.membership.role.code;
  const serviceStatus = healthQuery.data?.healthz.status === "ok" && healthQuery.data?.readyz.status === "ok" ? "ok" : "checking";

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      pushToast("已退出登录", "info");
      navigate("/login", { replace: true });
    },
    onError: (error) => {
      pushToast(formatApiError(error), "info");
      navigate("/login", { replace: true });
    }
  });

  const userLabel = useMemo(() => {
    const user = meQuery.data?.user;
    if (!user) {
      return "加载中";
    }
    return user.name || user.email || user.phone || user.id;
  }, [meQuery.data?.user]);

  return (
    <div className="console-shell">
      {mobileOpen ? <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileOpen(false)} /> : null}
      <aside className={`side-nav${mobileOpen ? " is-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">TH</span>
          <div>
            <strong>THCPN</strong>
            <span>Research Console</span>
          </div>
          <Button
            aria-label="关闭导航"
            className="mobile-close"
            icon={<X size={18} />}
            onClick={() => setMobileOpen(false)}
            variant="ghost"
          />
        </div>
        <nav>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
                    key={item.to}
                    onClick={() => setMobileOpen(false)}
                    to={item.to}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <Button aria-label="打开导航" className="mobile-menu" icon={<Menu size={19} />} onClick={() => setMobileOpen(true)} />
          <div className="workspace-context">
            <span className="context-kicker">工作区上下文</span>
            <div className="workspace-selector">
              <select
                aria-label="选择工作区"
                disabled={workspaces.isLoading || workspaces.workspaces.length === 0}
                onChange={(event) => workspaces.setSelectedWorkspaceId(event.target.value)}
                value={workspaces.selectedWorkspaceId}
              >
                {workspaces.workspaces.length === 0 ? <option value="">无可用工作区</option> : null}
                {workspaces.workspaces.map((item) => (
                  <option key={item.workspace.id} value={item.workspace.id}>
                    {item.workspace.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </div>
            <div className="context-meta">
              <Badge tone={statusTone(workspaces.selectedWorkspace?.workspace.status)}>
                {workspaces.selectedWorkspace?.workspace.status || "unknown"}
              </Badge>
              <span>{selectedRole || "未分配角色"}</span>
              <span>API {serviceStatus}</span>
              <span>{healthQuery.data?.checkedAt ? formatDateTime(healthQuery.data.checkedAt) : "未检查"}</span>
            </div>
          </div>
          <div className="topbar-user">
            <div>
              <span>{userLabel}</span>
              <small>{meQuery.data?.user.email || meQuery.data?.user.phone || "当前账号"}</small>
            </div>
            <Button
              disabled={logoutMutation.isPending}
              icon={<LogOut size={16} />}
              onClick={() => logoutMutation.mutate()}
              variant="ghost"
            >
              退出
            </Button>
          </div>
        </header>

        {workspaces.error ? (
          <main className="content-area">
            <ErrorState error={workspaces.error} onRetry={workspaces.refetch} />
          </main>
        ) : workspaces.isLoading ? (
          <main className="content-area">
            <LoadingState label="正在加载工作区" />
          </main>
        ) : (
          <main className="content-area">
            <Outlet />
          </main>
        )}

        <button
          className="health-strip"
          onClick={() => {
            void healthQuery.refetch();
            void queryClient.invalidateQueries({ queryKey: ["me"] });
          }}
          type="button"
        >
          <span className={`health-dot ${serviceStatus === "ok" ? "is-ok" : ""}`} />
          <span>healthz {healthQuery.data?.healthz.status || "-"}</span>
          <span>readyz {healthQuery.data?.readyz.status || "-"}</span>
        </button>
      </div>
    </div>
  );
}
