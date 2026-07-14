import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, authStorage, type User } from "@thcpn/api";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signIn: (tokens: { access_token: string; refresh_token: string; user: User }) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tokens = authStorage.read();
    if (!tokens) {
      setLoading(false);
      return;
    }
    api.me().then(({ user: currentUser }) => setUser(currentUser)).catch(() => {
      authStorage.clear();
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signIn: (tokens) => {
      authStorage.write({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token });
      setUser(tokens.user);
    },
    signOut: async () => {
      try { await api.auth.logout(); } finally {
        authStorage.clear();
        setUser(null);
        queryClient.clear();
      }
    }
  }), [loading, queryClient, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="app-loading">正在恢复会话…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

export function RequireSystemAdmin({ children, forbidden }: { children: ReactNode; forbidden?: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">正在检查权限…</div>;
  if (!user) return <Navigate to="/login?next=%2Fadmin" replace />;
  if (!user.is_system_admin) return <>{forbidden ?? <div role="alert">403 · 无权访问系统后台</div>}</>;
  return <>{children}</>;
}
