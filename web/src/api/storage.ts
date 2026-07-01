const ACCESS_TOKEN_KEY = "thcpn_access_token";
const REFRESH_TOKEN_KEY = "thcpn_refresh_token";
const WORKSPACE_KEY = "thcpn_workspace_id";

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
}

export const authStorage = {
  read(): StoredAuth {
    return {
      accessToken: localStorage.getItem(ACCESS_TOKEN_KEY) ?? "",
      refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY) ?? ""
    };
  },

  write(accessToken: string, refreshToken?: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
  },

  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
};

export const workspaceStorage = {
  read(): string {
    return localStorage.getItem(WORKSPACE_KEY) ?? "";
  },

  write(workspaceId: string): void {
    if (workspaceId) {
      localStorage.setItem(WORKSPACE_KEY, workspaceId);
    }
  },

  clear(): void {
    localStorage.removeItem(WORKSPACE_KEY);
  }
};
