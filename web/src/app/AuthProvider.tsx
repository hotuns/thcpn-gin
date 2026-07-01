import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authApi, authStorage, type LoginResponse } from "../api";

interface AuthContextValue {
  accessToken: string;
  refreshToken: string;
  isAuthenticated: boolean;
  applyLogin: (result: LoginResponse) => void;
  clearAuth: () => void;
  refreshAccessToken: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = authStorage.read();
  const [accessToken, setAccessToken] = useState(initial.accessToken);
  const [refreshToken, setRefreshToken] = useState(initial.refreshToken);
  const queryClient = useQueryClient();

  const applyLogin = useCallback(
    (result: LoginResponse) => {
      authStorage.write(result.access_token, result.refresh_token);
      setAccessToken(result.access_token);
      setRefreshToken(result.refresh_token);
      void queryClient.invalidateQueries();
    },
    [queryClient]
  );

  const clearAuth = useCallback(() => {
    authStorage.clear();
    setAccessToken("");
    setRefreshToken("");
    queryClient.clear();
  }, [queryClient]);

  const refreshAccessToken = useCallback(async () => {
    const token = refreshToken || authStorage.read().refreshToken;
    if (!token) {
      throw new Error("没有可用 refresh token");
    }
    const result = await authApi.refreshAuth(token);
    applyLogin(result);
  }, [applyLogin, refreshToken]);

  const logout = useCallback(async () => {
    const token = refreshToken || authStorage.read().refreshToken;
    try {
      if (accessToken) {
        await authApi.logout(token || undefined);
      }
    } finally {
      clearAuth();
    }
  }, [accessToken, clearAuth, refreshToken]);

  const value = useMemo(
    () => ({
      accessToken,
      refreshToken,
      isAuthenticated: Boolean(accessToken),
      applyLogin,
      clearAuth,
      refreshAccessToken,
      logout
    }),
    [accessToken, applyLogin, clearAuth, logout, refreshAccessToken, refreshToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
