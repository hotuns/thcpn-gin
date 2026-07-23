import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, adminAuthClearedEvent, adminAuthStorage, authClearedEvent, authStorage, type AdminUser, type User } from "@thcpn/api";
import { useLocale } from "@thcpn/i18n";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signIn: (tokens: { access_token: string; refresh_token: string; user: User }) => void;
  refreshUser: () => Promise<void>;
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
    api.me.get().then(({ user: currentUser }) => setUser(currentUser)).catch(() => {
      authStorage.clear();
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleCleared = () => { setUser(null); queryClient.clear(); };
    window.addEventListener(authClearedEvent, handleCleared);
    return () => window.removeEventListener(authClearedEvent, handleCleared);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signIn: (tokens) => {
      authStorage.write({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token });
      setUser(tokens.user);
    },
    refreshUser: async () => {
      const { user: currentUser } = await api.me.get();
      setUser(currentUser);
    },
    signOut: async () => {
      const tokens = authStorage.read();
      try { await api.auth.logout(tokens?.refreshToken); } finally {
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
  const { t } = useLocale();
  const location = useLocation();
  if (loading) return <div className="app-loading">{t("sessionRestoring")}</div>;
  if (!user) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?next=${encodeURIComponent(target)}`} replace />;
  }
  return <>{children}</>;
}

type AdminAuthContextValue = {
  admin: AdminUser | null;
  loading: boolean;
  signIn: (tokens: { access_token: string; refresh_token: string; admin: AdminUser }) => void;
  signOut: () => Promise<void>;
  refreshAdmin: () => Promise<void>;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!adminAuthStorage.read()) { setLoading(false); return; }
    api.adminAuth.me().then(({ admin: current }) => setAdmin(current)).catch(() => adminAuthStorage.clear()).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const handleCleared = () => { setAdmin(null); queryClient.clear(); };
    window.addEventListener(adminAuthClearedEvent, handleCleared);
    return () => window.removeEventListener(adminAuthClearedEvent, handleCleared);
  }, [queryClient]);
  const value = useMemo<AdminAuthContextValue>(() => ({
    admin,
    loading,
    signIn: (tokens) => { adminAuthStorage.write({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token }); setAdmin(tokens.admin); },
    signOut: async () => { const tokens = adminAuthStorage.read(); try { await api.adminAuth.logout(tokens?.refreshToken); } finally { adminAuthStorage.clear(); setAdmin(null); queryClient.clear(); } },
    refreshAdmin: async () => { const { admin: current } = await api.adminAuth.me(); setAdmin(current); },
  }), [admin, loading, queryClient]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return context;
}
