import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings";
import { deviceDetailTab } from "./devices-page";
import { platformBreadcrumbs } from "./platform-breadcrumbs";

vi.mock("./features", () => ({
  simplifiedEnabled: true,
  billingEnabled: false,
  platformHomePath: "/atlas",
}));
vi.mock("@thcpn/auth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@thcpn/workspace", () => ({
  useWorkspace: () => ({ currentId: "workspace-1", current: { name: "客户空间" } }),
  workspaceQueryKey: (id: string, ...parts: string[]) => ["workspace", id, ...parts],
}));

function settings(tab: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("simplified page entry points", () => {
  it("keeps member administration without external sharing or workspace creation", () => {
    const html = settings("access");
    expect(html).toContain("添加成员");
    expect(html).toContain("成员管理");
    for (const text of ["创建授权", "创建邀请", "我收到的邀请", "我收到的访问", "返回组织", "新建组织"])
      expect(html).not.toContain(text);
  });

  it("preserves basic settings and audit tabs", () => {
    const html = settings("resources");
    expect(html).toContain("基础资料");
    expect(html).toContain("审计日志");
  });

  it("normalizes direct links to hidden device tabs while keeping data and media", () => {
    expect(deviceDetailTab("config", false)).toBe("overview");
    expect(deviceDetailTab("sharing", false)).toBe("overview");
    expect(deviceDetailTab("config", false, true)).toBe("overview");
    expect(deviceDetailTab("data", false)).toBe("data");
    expect(deviceDetailTab("video", true)).toBe("video");
    expect(deviceDetailTab("profile", false)).toBe("profile");
    expect(deviceDetailTab("activity", false)).toBe("activity");
  });

  it("uses atlas as the breadcrumb root without linking omitted workspace pages", () => {
    expect(platformBreadcrumbs("/atlas")).toEqual([{ key: "wallboards" }]);
    expect(platformBreadcrumbs("/devices/device-1")[0]).toEqual({ key: "wallboards", to: "/atlas" });
    expect(platformBreadcrumbs("/settings")).toEqual([
      { key: "wallboards", to: "/atlas" }, { key: "settings" },
    ]);
  });
});
