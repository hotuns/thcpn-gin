import { act } from "react";
import { useQuery } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { api, authStorage, type User, type WorkspaceWithMembership } from "@thcpn/api";
import { AuthProvider, RequireAuth, useAuth } from "@thcpn/auth";
import { WorkspaceProvider, useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { render, eventually } from "./render";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function LoginDestination() {
  const location = useLocation();
  return <output data-testid="login-destination">{location.pathname}{location.search}</output>;
}

function SignedInPage() {
  const { user, signOut } = useAuth();
  return <div data-testid="private-page">
    {user?.id}
    <button onClick={() => { void signOut().catch(() => {}); }}>Sign out</button>
  </div>;
}

function SessionRoutes() {
  return <MemoryRouter initialEntries={["/devices?site=forest#node"]}>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginDestination />} />
        <Route path="/devices" element={<RequireAuth><SignedInPage /></RequireAuth>} />
      </Routes>
    </AuthProvider>
  </MemoryRouter>;
}

it("redirects anonymous access without rendering private content and preserves the deep link", async () => {
  const restore = vi.spyOn(api.me, "get");
  const { host } = await render(<SessionRoutes />);

  const destination = host.querySelector('[data-testid="login-destination"]')?.textContent;
  expect(destination).toBeTruthy();
  expect(new URL(destination!, "http://localhost").searchParams.get("next")).toBe("/devices?site=forest#node");
  expect(host.querySelector('[data-testid="private-page"]')).toBeNull();
  expect(restore).not.toHaveBeenCalled();
});

it("waits for session restoration and clears private cache even if logout fails", async () => {
  authStorage.write({ accessToken: "access", refreshToken: "refresh" });
  const session = deferred<{ user: User }>();
  vi.spyOn(api.me, "get").mockReturnValue(session.promise);
  const logout = vi.spyOn(api.auth, "logout").mockRejectedValue(new Error("offline"));
  const { host, client } = await render(<SessionRoutes />);
  client.setQueryData(["workspace", "forest", "devices"], ["private-data"]);
  expect(host.querySelector('[data-testid="private-page"]')).toBeNull();
  expect(host.querySelector('[data-testid="login-destination"]')).toBeNull();

  await act(async () => session.resolve({ user: { id: "user-1", name: "Observer", status: "active" } }));
  expect(host.querySelector('[data-testid="private-page"]')?.textContent).toContain("user-1");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());

  await eventually(() => expect(host.querySelector('[data-testid="login-destination"]')).not.toBeNull());
  expect(logout).toHaveBeenCalledWith("refresh");
  expect(authStorage.read()).toBeNull();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

const stamp = "2026-11-03T00:00:00Z";
const workspaces: WorkspaceWithMembership[] = ["forest", "grassland"].map((id) => ({
  workspace: { id, type: "organization", name: id, owner_user_id: "user-1", status: "active", created_at: stamp, updated_at: stamp },
  membership: { id: `membership-${id}`, status: "active", joined_at: stamp, scope_type: "workspace", scope_id: id, role: { id: "viewer", code: "viewer", name: "Viewer" } },
}));

function WorkspaceData({ load }: { load: (id: string) => Promise<string> }) {
  const { currentId, current, setCurrentId } = useWorkspace();
  const query = useQuery({
    queryKey: workspaceQueryKey(currentId, "observations"),
    queryFn: () => load(currentId!),
    enabled: !!current,
  });
  return <>
    <output data-testid="current-workspace">{current?.id}</output>
    <output data-testid="observations">{query.data ?? "loading"}</output>
    <button onClick={() => setCurrentId("grassland")}>Switch workspace</button>
  </>;
}

it("replaces a persisted inaccessible workspace with one the user can access", async () => {
  localStorage.setItem("thcpn.workspace.current", "removed-workspace");
  vi.spyOn(api.workspaces, "list").mockResolvedValue({ items: workspaces });
  const load = vi.fn(async (id: string) => `${id}-data`);
  const { host } = await render(<WorkspaceProvider><WorkspaceData load={load} /></WorkspaceProvider>);

  await eventually(() => expect(host.querySelector('[data-testid="observations"]')?.textContent).toBe("forest-data"));
  expect(localStorage.getItem("thcpn.workspace.current")).toBe("forest");
  expect(load.mock.calls.every(([id]) => id === "forest")).toBe(true);
});

it("switches workspace data without showing the previous workspace while the new query is pending", async () => {
  localStorage.setItem("thcpn.workspace.current", "forest");
  vi.spyOn(api.workspaces, "list").mockResolvedValue({ items: workspaces });
  const grassland = deferred<string>();
  const load = vi.fn((id: string) => id === "forest" ? Promise.resolve("forest-private-data") : grassland.promise);
  const { host, client } = await render(<WorkspaceProvider><WorkspaceData load={load} /></WorkspaceProvider>);
  await eventually(() => expect(host.querySelector('[data-testid="observations"]')?.textContent).toBe("forest-private-data"));

  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector('[data-testid="current-workspace"]')?.textContent).toBe("grassland");
  expect(host.querySelector('[data-testid="observations"]')?.textContent).toBe("loading");
  expect(localStorage.getItem("thcpn.workspace.current")).toBe("grassland");
  expect(load).toHaveBeenCalledWith("grassland");

  await act(async () => grassland.resolve("grassland-private-data"));
  await eventually(() => expect(host.querySelector('[data-testid="observations"]')?.textContent).toBe("grassland-private-data"));
  expect(client.getQueryData(workspaceQueryKey("forest", "observations"))).toBe("forest-private-data");
  expect(client.getQueryData(workspaceQueryKey("grassland", "observations"))).toBe("grassland-private-data");
});
