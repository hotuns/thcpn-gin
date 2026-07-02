import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Result, Space, Spin } from "antd";
import { authApi, formatApiError } from "../api";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { useAuth } from "./AuthProvider";

export function landingPathForUser(user?: { is_system_admin?: boolean }) {
  return user?.is_system_admin ? "/admin" : "/dashboard";
}

export function ProtectedRoute() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }

  return (
    <WorkspaceProvider>
      <Outlet />
    </WorkspaceProvider>
  );
}

export function AdminRouteGuard() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: authApi.me,
    enabled: isAuthenticated
  });

  if (!isAuthenticated) {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }

  if (meQuery.isLoading) {
    return (
      <Space className="state state-inline">
        <Spin size="small" />
        <span>正在检查系统管理员身份</span>
      </Space>
    );
  }

  if (meQuery.error) {
    return (
      <Result
        extra={<Button href="/login">重新登录</Button>}
        status="warning"
        subTitle={formatApiError(meQuery.error)}
        title="无法确认当前账号"
      />
    );
  }

  if (!meQuery.data?.user.is_system_admin) {
    return (
      <Result
        extra={<Button href="/dashboard">进入普通控制台</Button>}
        status="403"
        subTitle="系统后台只允许系统管理员访问。工作区管理员权限不能进入这里。"
        title="无系统后台权限"
      />
    );
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { isAuthenticated } = useAuth();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: authApi.me,
    enabled: isAuthenticated
  });

  if (isAuthenticated) {
    if (meQuery.isLoading) {
      return (
        <Space className="state state-inline">
          <Spin size="small" />
          <span>正在进入控制台</span>
        </Space>
      );
    }
    return <Navigate replace to={landingPathForUser(meQuery.data?.user)} />;
  }

  return <Outlet />;
}

export function RootRedirect() {
  const { isAuthenticated } = useAuth();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: authApi.me,
    enabled: isAuthenticated
  });

  if (!isAuthenticated) {
    return <Navigate replace to="/login" />;
  }

  if (meQuery.isLoading) {
    return (
      <Space className="state state-inline">
        <Spin size="small" />
        <span>正在进入控制台</span>
      </Space>
    );
  }

  return <Navigate replace to={landingPathForUser(meQuery.data?.user)} />;
}
