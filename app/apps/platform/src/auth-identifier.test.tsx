// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AuthPage } from "./auth-pages";

vi.mock("@thcpn/auth", () => ({ useAuth: () => ({ user: null, signIn: vi.fn() }) }));
vi.mock("@thcpn/i18n", async importOriginal => ({
  ...await importOriginal<object>(),
  useLocale: () => ({ t: (key: string) => key }),
  LanguageSwitcher: () => null,
}));
vi.mock("./login-visual-carousel", () => ({ LoginVisualCarousel: () => null }));
vi.mock("@thcpn/api", async importOriginal => ({
  ...await importOriginal<object>(),
  api: { auth: { loginVisuals: async () => ({ items: [] }) } },
}));

it("renders a password-login identifier that accepts both email and phone", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><AuthPage /></MemoryRouter></QueryClientProvider>));
    const account = host.querySelector<HTMLInputElement>('input[autocomplete="username"]')!;
    expect(account).not.toBeNull();
    expect(account.closest("label")?.textContent).toContain("platform:auth.identifier");
    for (const value of ["test@user.com", "10000000000"]) {
      account.value = value;
      expect(account.checkValidity()).toBe(true);
    }
    account.value = "";
    expect(account.checkValidity()).toBe(false);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
  }
});
