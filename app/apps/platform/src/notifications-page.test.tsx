// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@thcpn/api";
import { NotificationsPage } from "./notifications-page";

vi.mock("@thcpn/workspace", () => ({
  useWorkspace: () => ({ currentId: "workspace", current: { name: "森林观测" } }),
  workspaceQueryKey: (id: string, ...parts: string[]) => ["workspace", id, ...parts],
}));
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const button = (name: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.includes(name))!;
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
beforeEach(async () => {
  vi.spyOn(api.notifications, "list").mockResolvedValue({ unread_count: 1, items: [{ id: "notice", title: "任务完成", action_url: "/exports" }] });
  vi.spyOn(api.notifications, "announcements").mockResolvedValue({ unread_count: 0, items: [{ id: "announcement", title: "平台公告", read_at: "2026-10-23" }] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root?.unmount()); host?.remove(); client.clear(); vi.restoreAllMocks();
});
const render = async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><NotificationsPage /></MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
};
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };

it("keeps failed mark-read actions visible, prevents duplicate requests, and refreshes after retry", async () => {
  let rejectRead!: (error: Error) => void;
  const read = vi.spyOn(api.notifications, "read").mockImplementationOnce(() => new Promise((_, reject) => { rejectRead = reject; }));
  await render();
  expect(host.querySelector('a[href="/exports"]')?.querySelector("button")).toBeNull();
  await click(button("标为已读"));
  await settle();
  expect(button("标为已读").disabled).toBe(true);
  await click(button("标为已读"));
  expect(read).toHaveBeenCalledOnce();
  await act(async () => rejectRead(new Error("暂时无法更新已读状态")));
  await settle();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("暂时无法更新已读状态");
  read.mockResolvedValueOnce(undefined);
  vi.mocked(api.notifications.list).mockResolvedValue({ unread_count: 0, items: [{ id: "notice", title: "任务完成", read_at: "2026-10-23" }] });
  await click(button("标为已读"));
  await settle();
  expect(read).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect([...host.querySelectorAll("button")].some(item => item.textContent === "标为已读")).toBe(false);
});

it("connects tabs to their content and supports arrow-key navigation", async () => {
  await render();
  const active = host.querySelector<HTMLElement>('[role="tab"][data-state="active"]')!;
  const panel = host.querySelector('[role="tabpanel"]')!;
  expect(active.getAttribute("aria-controls")).toBe(panel.id);
  await act(async () => {
    active.focus();
    active.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  await settle();
  expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain("平台公告");
});
