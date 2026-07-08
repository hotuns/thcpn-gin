import { useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DownOutlined,
  ExportOutlined,
  HddOutlined,
  LineChartOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { Alert, App as AntApp, Button, Drawer, Dropdown, Layout, Menu, Result, Space, Spin, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import { authApi, formatApiError, statusApi } from "../api";
import { useAuth } from "./AuthProvider";
import { useWorkspace } from "./WorkspaceProvider";

const { Content, Sider } = Layout;

const navGroups = [
  {
    label: "运行",
    items: [
      { to: "/dashboard", label: "总览", icon: <DashboardOutlined /> },
      { to: "/devices", label: "设备", icon: <HddOutlined /> }
    ]
  },
  {
    label: "数据",
    items: [
      { to: "/device-data", label: "设备数据", icon: <LineChartOutlined /> },
      { to: "/datasets", label: "数据集", icon: <DatabaseOutlined /> },
      { to: "/export-jobs", label: "导出", icon: <ExportOutlined /> }
    ]
  },
  {
    label: "管理",
    items: [
      { to: "/settings", label: "设置", icon: <SettingOutlined /> }
    ]
  }
];

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuth();
  const { message } = AntApp.useApp();
  const location = useLocation();
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
      void message.info("已退出登录");
      navigate("/login", { replace: true });
    },
    onError: (error) => {
      void message.info(formatApiError(error));
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

  const menuItems = useMemo<MenuProps["items"]>(
    () =>
      navGroups.map((group) => ({
        children: group.items.map((item) => ({
          icon: item.icon,
          key: item.to,
          label: item.label
        })),
        key: group.label,
        label: group.label,
        type: "group"
      })),
    []
  );

  const selectedMenuKey = useMemo(() => {
    const allItems = navGroups.flatMap((group) => group.items);
    return allItems.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`))?.to || "/dashboard";
  }, [location.pathname]);

  const workspaceMenuItems = useMemo<MenuProps["items"]>(
    () => [
      ...workspaces.workspaces.map((item) => ({
        icon: item.workspace.id === workspaces.selectedWorkspaceId ? <CheckOutlined /> : undefined,
        key: `workspace:${item.workspace.id}`,
        label: (
          <div className="workspace-menu-item">
            <span className="workspace-menu-main">
              <Typography.Text strong ellipsis title={item.workspace.name}>
                {item.workspace.name}
              </Typography.Text>
              <Typography.Text type="secondary">{item.membership.role.name || item.membership.role.code}</Typography.Text>
            </span>
            <Tag color={item.workspace.status === "active" ? "success" : "warning"}>{item.workspace.status}</Tag>
          </div>
        )
      })),
      ...(workspaces.workspaces.length > 0
        ? []
        : [
            {
              disabled: true,
              key: "workspace-empty",
              label: "无可用工作区"
            }
          ]),
      { type: "divider" as const },
      {
        key: "workspace-actions",
        label: (
          <Space className="workspace-menu-actions" size={8}>
            <Button
              icon={<PlusOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                navigate("/workspaces?create=1");
                setMobileOpen(false);
              }}
              size="small"
              type="primary"
            >
              新建工作区
            </Button>
            <Button
              icon={<SettingOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                navigate("/workspaces");
                setMobileOpen(false);
              }}
              size="small"
            >
              管理工作区
            </Button>
          </Space>
        )
      }
    ],
    [navigate, workspaces.selectedWorkspaceId, workspaces.workspaces]
  );

  const workspaceLabel = workspaces.selectedWorkspace?.workspace.name || "选择工作区";

  const sidebar = (
    <div className="side-nav-content">
      <div className="workspace-switcher-wrap">
        <Dropdown
          menu={{
            items: workspaceMenuItems,
            selectedKeys: workspaces.selectedWorkspaceId ? [`workspace:${workspaces.selectedWorkspaceId}`] : [],
            onClick: ({ key }) => {
              const keyText = String(key);
              if (!keyText.startsWith("workspace:")) {
                return;
              }
              workspaces.setSelectedWorkspaceId(keyText.replace("workspace:", ""));
              setMobileOpen(false);
            }
          }}
          placement="bottomLeft"
          trigger={["click"]}
        >
          <Button className="workspace-switcher" disabled={workspaces.isLoading} type="text">
            <span className="workspace-switcher-copy">
              <Typography.Text className="context-kicker" type="secondary">
                工作区
              </Typography.Text>
              <Typography.Text strong ellipsis title={workspaceLabel}>
                {workspaceLabel}
              </Typography.Text>
              <Space className="context-meta" size={[6, 4]} wrap>
                <Tag color={workspaces.selectedWorkspace?.workspace.status === "active" ? "success" : "warning"}>
                  {workspaces.selectedWorkspace?.workspace.status || "unknown"}
                </Tag>
                <Typography.Text type="secondary">{selectedRole || "未分配角色"}</Typography.Text>
              </Space>
            </span>
            <DownOutlined />
          </Button>
        </Dropdown>
      </div>
      <Menu
        className="main-menu"
        items={menuItems}
        mode="inline"
        onClick={({ key }) => {
          navigate(String(key));
          setMobileOpen(false);
        }}
        selectedKeys={[selectedMenuKey]}
      />
      <div className="side-controls">
        <div className="side-account">
          <div className="side-account-copy">
            <Typography.Text strong ellipsis title={userLabel}>
              {userLabel}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis title={meQuery.data?.user.email || meQuery.data?.user.phone || "当前账号"}>
              {meQuery.data?.user.email || meQuery.data?.user.phone || "当前账号"}
            </Typography.Text>
          </div>
          <Dropdown
            menu={{
              items: [
                ...(meQuery.data?.user.is_system_admin
                  ? [
                      {
                        icon: <SettingOutlined />,
                        key: "admin",
                        label: "进入系统后台",
                        onClick: () => navigate("/admin")
                      }
                    ]
                  : []),
                {
                  danger: true,
                  icon: <LogoutOutlined />,
                  key: "logout",
                  label: "退出登录",
                  onClick: () => logoutMutation.mutate()
                }
              ]
            }}
            trigger={["click"]}
          >
            <Button icon={<LogoutOutlined />} loading={logoutMutation.isPending} size="small">
              账号
            </Button>
          </Dropdown>
        </div>
        <Tooltip title="刷新服务状态和当前账号">
          <Button
            className="side-health"
            htmlType="button"
            onClick={() => {
              void healthQuery.refetch();
              void queryClient.invalidateQueries({ queryKey: ["me"] });
            }}
            type="text"
          >
            <span className={`health-dot ${serviceStatus === "ok" ? "is-ok" : ""}`} />
            <span>healthz {healthQuery.data?.healthz.status || "-"}</span>
            <span>readyz {healthQuery.data?.readyz.status || "-"}</span>
            <ReloadOutlined />
          </Button>
        </Tooltip>
      </div>
    </div>
  );

  return (
    <Layout className="console-layout">
      <Sider className="app-sider" width={264}>
        {sidebar}
      </Sider>
      <Drawer
        className="mobile-nav-drawer"
        onClose={() => setMobileOpen(false)}
        open={mobileOpen}
        placement="left"
        size={292}
      >
        {sidebar}
      </Drawer>

      <Layout className="main-area">
        <Button aria-label="打开导航" className="mobile-menu" icon={<MenuOutlined />} onClick={() => setMobileOpen(true)} />

        {workspaces.error ? (
          <Content className="content-area">
            <Result
              className="state state-error"
              extra={<Button onClick={workspaces.refetch}>重试</Button>}
              status="warning"
              subTitle={<Alert message={formatApiError(workspaces.error)} showIcon type="error" />}
              title="请求未完成"
            />
          </Content>
        ) : workspaces.isLoading ? (
          <Content className="content-area">
            <Space className="state state-inline">
              <Spin size="small" />
              <span>正在加载工作区</span>
            </Space>
          </Content>
        ) : (
          <Content className="content-area">
            <Outlet />
          </Content>
        )}
      </Layout>
    </Layout>
  );
}
