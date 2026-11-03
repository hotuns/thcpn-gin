import { RequireAuth, useAuth } from "@thcpn/auth";
import {
  WorkspaceProvider
} from "@thcpn/workspace";
import {
  Navigate,
  Outlet
} from "react-router-dom";



export function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading t-shimmer" data-text="正在恢复会话…">正在恢复会话…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to="/dashboard" replace />;
}
export function RequirePlatform() {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <Outlet />
      </WorkspaceProvider>
    </RequireAuth>
  );
}
