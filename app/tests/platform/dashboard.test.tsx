import { act, useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type DashboardCount, type DashboardOverview, type WorkspaceWithMembership } from "@thcpn/api";
import { I18nProvider, useLocale, type SupportedLocale } from "@thcpn/i18n";
import { WorkspaceProvider, useWorkspace } from "@thcpn/workspace";
import { DashboardPage } from "../../apps/platform/src/features/dashboard/dashboard-page";
import { render, eventually } from "../render";

const stamp = "2026-11-03T06:00:00Z";
const workspaces: WorkspaceWithMembership[] = ["forest", "grassland"].map((id) => ({
  workspace: { id, type: "organization", name: id, owner_user_id: "observer", status: "active", created_at: stamp, updated_at: stamp },
  membership: { id: `membership-${id}`, status: "active", joined_at: stamp, scope_type: "workspace", scope_id: id, role: { id: "viewer", code: "viewer", name: "Viewer" } },
}));
const count = (value: number | null, complete = true): DashboardCount => ({ value, complete, covered_devices: complete ? 3 : 1, total_devices: 3 });
function overview(): DashboardOverview {
  return {
    generated_at: stamp, statistics_updated_at: "2026-11-03T05:55:00Z", timezone: "Asia/Shanghai", days: 7, refresh_interval_seconds: 30,
    records: { total: count(12345), today: count(18), first_observed_at: "2026-01-01T00:00:00Z" },
    images: { total: count(240), today: count(3) },
    trend: [
      { date: "2026-11-02", records: 20, images: 4, records_complete: true, images_complete: true },
      { date: "2026-11-03", records: 18, images: 3, records_complete: true, images_complete: true },
    ],
    devices: { total: 3, reporting: 2, delayed: 1, no_data: 0, unknown: 0, inactive: 0 },
    attention: [{ id: "delayed:device-1", device_id: "device-1", name: "Forest station", kind: "delayed", last_observed_at: stamp, threshold_seconds: 600 }],
    active_alerts: 1,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function Controls({ language }: { language: SupportedLocale }) {
  const { setCurrentId } = useWorkspace();
  const { locale, setLocale } = useLocale();
  useEffect(() => { if (locale !== language) void setLocale(language); }, [language, locale, setLocale]);
  return <button onClick={() => setCurrentId("grassland")}>Switch workspace</button>;
}
async function mount(language: SupportedLocale = "en-US") {
  return render(<MemoryRouter><I18nProvider><WorkspaceProvider><Controls language={language} /><DashboardPage /></WorkspaceProvider></I18nProvider></MemoryRouter>);
}
function button(host: HTMLElement, text: string) {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === text);
  expect(result, `button ${text}`).toBeTruthy();
  return result!;
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  localStorage.setItem("thcpn.workspace.current", "forest");
  vi.spyOn(api.workspaces, "list").mockResolvedValue({ items: workspaces });
});

it.each(["en-US", "zh-CN"] as const)("shows unknown, partial numeric and zero values without completeness labels (%s)", async (language) => {
  const english = language === "en-US";
  const unknown = english ? "Unknown" : "未知";
  const data = overview();
  data.records.total = count(null, false);
  data.records.today = count(18, false);
  data.images.total = count(0);
  data.statistics_updated_at = null;
  data.devices.unknown = 2;
  data.devices.reporting = 0;
  data.attention = [];
  data.trend[0] = { date: "2026-11-02", records: null, images: 0, records_complete: false, images_complete: true };
  data.trend[1].records_complete = false;
  vi.spyOn(api, "dashboard").mockResolvedValue(data);
  const { host } = await mount(language);
  await eventually(() => expect(host.querySelector('[data-testid="overview-today"]')?.textContent).toBe("18"));
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe(unknown);
  expect(host.querySelector('[data-testid="overview-images"]')?.textContent).toBe("0");
  expect(host.textContent).not.toMatch(/部分设备的数据尚未计入|部分统计|覆盖 \d|统计不完整|Partial statistics|Covers \d|not complete totals|incomplete statistics|Refreshes every|每 \d+ 秒刷新/);
  expect(host.querySelector(".overview-coverage")).toBeNull();
  expect(host.textContent).toContain(english ? "2 unknown" : "状态未知 2 台");
  expect(host.textContent).toContain(english ? "Statistics update time unknown" : "统计更新时间未知");
  expect(host.textContent).not.toContain(english ? "No devices currently need attention" : "当前没有需要关注的设备");
  const targets = host.querySelectorAll<HTMLButtonElement>(".overview-bar-target");
  expect(targets[0].querySelector(".overview-bar")).toBeNull();
  expect(targets[0].getAttribute("aria-label")).toContain(unknown);
  expect(targets[1].getAttribute("aria-label")).toBe(english ? "Nov 3, 2026 · Observation records 18" : "2026年11月3日 · 观测记录 18");
  await act(async () => targets[0].focus());
  expect(host.querySelector(".overview-chart-readout strong")?.textContent).toBe(unknown);
  await act(async () => targets[1].click());
  expect(host.querySelector(".overview-chart-readout strong")?.textContent).toBe("18");
  expect(host.querySelector(".overview-chart-readout span")?.textContent).toBe(english ? "Observation records · Nov 3, 2026" : "观测记录 · 2026年11月3日");
  await act(async () => targets[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector(".overview-chart-readout strong")).toBeNull();
  await act(async () => button(host, english ? "Images" : "图片").click());
  await act(async () => targets[0].click());
  expect(host.querySelector(".overview-chart-readout strong")?.textContent).toBe("0");
  expect(targets[0].querySelector(".overview-zero-mark")?.textContent).toBe("0");
  await act(async () => button(host, english ? "Data table" : "数据表").click());
  expect(Array.from(host.querySelectorAll("tbody tr:first-child td"), (cell) => cell.textContent)).toEqual([unknown, "0"]);
  expect(Array.from(host.querySelectorAll("tbody tr:last-child td"), (cell) => cell.textContent)).toEqual(["18", "3"]);
  expect(host.querySelector(".overview-trend")?.textContent).not.toMatch(/Partial|Complete|部分统计|完整/);
  expect(host.querySelector(".overview-table-status")).toBeNull();
});

it("shows initial loading until the request finishes", async () => {
  const initial = deferred<DashboardOverview>();
  vi.spyOn(api, "dashboard").mockReturnValue(initial.promise);
  const { host } = await mount();
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("Loading…");
  expect(host.querySelector(".overview-statistics")?.getAttribute("aria-busy")).toBe("true");
  expect(host.querySelector('.observation-overview > [role="status"]')?.textContent).toBe("Loading observation statistics…");
  expect(button(host, "Loading…").disabled).toBe(true);
  await act(async () => initial.resolve(overview()));
  await eventually(() => expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345"));
  expect(host.querySelector(".overview-statistics")?.getAttribute("aria-busy")).toBe("false");
  expect(button(host, "Refresh").disabled).toBe(false);
});

it("explains statistics preparation and lets the user refresh manually", async () => {
  const cold = overview();
  cold.refresh_interval_seconds = 5;
  cold.records = { total: count(null, false), today: count(null, false), first_observed_at: null };
  cold.images = { total: count(null, false), today: count(null, false) };
  const load = vi.spyOn(api, "dashboard").mockResolvedValueOnce(cold).mockResolvedValueOnce(overview());
  const { host } = await mount();
  await eventually(() => expect(host.textContent).toContain("Observation statistics are being prepared. Refresh in a moment to view them."));
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("Unknown");
  expect(button(host, "Refresh").disabled).toBe(false);
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => button(host, "Refresh").click());
  await eventually(() => expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345"));
  expect(host.textContent).not.toContain("statistics are being prepared");
});

it.each([5, 30])("does not refresh automatically for a %s-second backend interval, focus or reconnect", async (seconds) => {
  vi.useFakeTimers();
  try {
    const data = overview();
    data.refresh_interval_seconds = seconds;
    const load = vi.spyOn(api, "dashboard").mockResolvedValue(data);
    const { host } = await mount();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345");
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => button(host, "Refresh").click());
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => button(host, "Last 30 days").click());
    expect(load).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenLastCalledWith("forest", 30);
  } finally {
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.useRealTimers();
  }
});

it("keeps cached statistics on remount until the user refreshes", async () => {
  const load = vi.spyOn(api, "dashboard").mockResolvedValue(overview());
  function View() {
    const [visible, setVisible] = useState(true);
    return <><button onClick={() => setVisible(value => !value)}>Toggle overview</button>{visible && <DashboardPage />}</>;
  }
  const { host } = await render(<MemoryRouter><I18nProvider><WorkspaceProvider><Controls language="en-US" /><View /></WorkspaceProvider></I18nProvider></MemoryRouter>);
  await eventually(() => expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345"));
  await act(async () => button(host, "Toggle overview").click());
  await act(async () => button(host, "Toggle overview").click());
  expect(load).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345");
  await act(async () => button(host, "Refresh").click());
  expect(load).toHaveBeenCalledTimes(2);
});

it("keeps lifetime totals and the chart frame while changing range and refreshing", async () => {
  const data = overview();
  const thirty = deferred<DashboardOverview>();
  const reload = deferred<DashboardOverview>();
  const load = vi.spyOn(api, "dashboard").mockResolvedValueOnce(data).mockReturnValueOnce(thirty.promise).mockReturnValueOnce(reload.promise);
  const { host } = await mount();
  await eventually(() => expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345"));
  const frame = host.querySelector('[data-testid="overview-trend-frame"]');
  await act(async () => button(host, "Last 30 days").click());
  expect(load).toHaveBeenLastCalledWith("forest", 30);
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345");
  expect(host.querySelector('[data-testid="overview-trend-frame"]')).toBe(frame);
  expect(host.textContent).toContain("The chart still shows the previous range");
  await act(async () => thirty.resolve({ ...data, days: 30, trend: [{ date: "2026-10-05", records: 5, images: 2, records_complete: true, images_complete: true }, ...data.trend] }));
  await eventually(() => expect(host.querySelectorAll(".overview-bar-target")).toHaveLength(3));
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345");
  await act(async () => button(host, "Refresh").click());
  expect(button(host, "Refreshing…").disabled).toBe(true);
  expect(host.querySelector('.observation-overview > [role="status"]')?.textContent).toBe("Refreshing…");
  expect(host.querySelector(".overview-statistics")?.getAttribute("aria-busy")).toBe("true");
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345");
  expect(host.querySelector('[data-testid="overview-trend-frame"]')).toBe(frame);
  expect(host.querySelectorAll(".overview-bar-target")).toHaveLength(3);
  await act(async () => reload.resolve({ ...data, days: 30 }));
  await eventually(() => expect(button(host, "Refresh").disabled).toBe(false));
});

it("never carries counts or trend points into a different workspace while it loads", async () => {
  const next = deferred<DashboardOverview>();
  vi.spyOn(api, "dashboard").mockImplementation((id) => id === "forest" ? Promise.resolve(overview()) : next.promise);
  const { host } = await mount();
  await eventually(() => expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("12,345"));
  await act(async () => button(host, "Switch workspace").click());
  expect(host.textContent).toContain("Current workspace · grassland");
  expect(host.textContent).not.toContain("12,345");
  expect(host.textContent).not.toContain("Forest station");
  expect(host.querySelectorAll(".overview-bar-target")).toHaveLength(0);
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("Loading…");
  const data = overview();
  data.records.total = count(200);
  await act(async () => next.resolve(data));
  await eventually(() => expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("200"));
});

it("does not report healthy devices when every source is unknown and keeps the frame after refresh errors", async () => {
  const data = overview();
  data.records = { total: count(null, false), today: count(null, false), first_observed_at: null };
  data.images = { total: count(null, false), today: count(null, false) };
  data.devices = { total: 3, reporting: 0, delayed: 0, no_data: 0, unknown: 3, inactive: 0 };
  data.attention = [];
  data.active_alerts = null;
  data.trend = [];
  const load = vi.spyOn(api, "dashboard").mockResolvedValueOnce(data).mockRejectedValueOnce(new Error("offline"));
  const { host } = await mount();
  await eventually(() => expect(host.textContent).toContain("Unknown does not mean there is no data"));
  expect(host.textContent).toContain("Problems cannot be ruled out");
  expect(host.querySelector('[data-testid="overview-reporting"]')?.textContent).toBe("Unknown");
  expect(host.textContent).not.toContain("No devices currently need attention");
  const frame = host.querySelector('[data-testid="overview-trend-frame"]');
  await act(async () => button(host, "Refresh").click());
  await eventually(() => expect(host.textContent).toContain("Refresh failed"));
  expect(load).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-testid="overview-trend-frame"]')).toBe(frame);
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("Unknown");
});
