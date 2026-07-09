import { useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppstoreOutlined,
  ControlOutlined,
  DashboardOutlined,
  HddOutlined,
  LogoutOutlined,
  MenuOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { App as AntApp, Button, Drawer, Dropdown, Layout, Menu, Space, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import { authApi, formatApiError, statusApi } from "../api";
import { useAuth } from "./AuthProvider";

const { Content, Sider } = Layout;

const adminNavItems = [
  { to: "/admin", label: "后台总览", icon: <DashboardOutlined /> },
  { to: "/admin/data-sources", label: "THCPN 数据源", icon: <ControlOutlined /> },
  { to: "/admin/devices", label: "设备管理", icon: <HddOutlined /> },
  { to: "/admin/metadata", label: "元数据管理", icon: <SettingOutlined /> }
];

export function AdminShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuth();
  const { message } = AntApp.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const healthQuery = useQuery({
    queryKey: ["service-status"],
    queryFn: async () => {
      const [healthz, readyz] = await Promise.all([statusApi.healthz(), statusApi.readyz()]);
      return { healthz, readyz };
    },
    refetchInterval: 60_000
  });

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

  const selectedMenuKey = useMemo(
    () => {
      if (location.pathname === "/admin") {
        return "/admin";
      }
      return adminNavItems.find((item) => item.to !== "/admin" && location.pathname.startsWith(`${item.to}/`))?.to || location.pathname;
    },
    [location.pathname]
  );
  const menuItems = useMemo<MenuProps["items"]>(
    () =>
      adminNavItems.map((item) => ({
        icon: item.icon,
        key: item.to,
        label: item.label
      })),
    []
  );
  const userLabel = meQuery.data?.user.name || meQuery.data?.user.email || meQuery.data?.user.phone || meQuery.data?.user.id || "系统管理员";
  const serviceStatus = healthQuery.data?.healthz.status === "ok" && healthQuery.data?.readyz.status === "ok" ? "ok" : "checking";

  const sidebar = (
    <div className="side-nav-content admin-side-nav">
      <div className="admin-shell-title">
        <Space size={10}>
          <span className="admin-mark">
            <SafetyCertificateOutlined />
          </span>
          <span>
            <Typography.Text strong>系统后台</Typography.Text>
            <Typography.Text type="secondary">THCPN Admin</Typography.Text>
          </span>
        </Space>
        <Tag color="purple">system</Tag>
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
            <Typography.Text type="secondary" ellipsis title={meQuery.data?.user.email || meQuery.data?.user.phone || "系统管理员"}>
              {meQuery.data?.user.email || meQuery.data?.user.phone || "系统管理员"}
            </Typography.Text>
          </div>
          <Dropdown
            menu={{
              items: [
                {
                  icon: <AppstoreOutlined />,
                  key: "console",
                  label: "进入普通控制台",
                  onClick: () => navigate("/dashboard")
                },
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
            <Button loading={logoutMutation.isPending} size="small">
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
    <Layout className="console-layout admin-console-layout">
      <Sider className="app-sider" width={264}>
        {sidebar}
      </Sider>
      <Drawer className="mobile-nav-drawer" onClose={() => setMobileOpen(false)} open={mobileOpen} placement="left" size="default">
        {sidebar}
      </Drawer>

      <Layout className="main-area">
        <Button aria-label="打开后台导航" className="mobile-menu" icon={<MenuOutlined />} onClick={() => setMobileOpen(true)} />
        <Content className="content-area">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
