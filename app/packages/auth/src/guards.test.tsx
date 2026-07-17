// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, authStorage } from "@thcpn/api";
import { AuthProvider, RequireAuth } from "./index";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root?.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthProvider>{element}</AuthProvider></QueryClientProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  authStorage.clear();
  vi.restoreAllMocks();
});

describe("route guards", () => {
  function LoginTarget() { const location = useLocation(); return <div>login target {location.search}</div>; }

  it("redirects an unauthenticated platform request to login with the original path", async () => {
    const view = await render(<MemoryRouter initialEntries={["/devices?site=site-1#node"]}><Routes><Route path="/login" element={<LoginTarget />} /><Route path="/devices" element={<RequireAuth><div>private devices</div></RequireAuth>} /></Routes></MemoryRouter>);
    expect(view.textContent).toContain("login target");
    expect(view.textContent).toContain("next=%2Fdevices%3Fsite%3Dsite-1%23node");
    expect(view.textContent).not.toContain("private devices");
  });

});
