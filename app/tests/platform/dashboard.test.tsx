import { act, useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type DashboardCount, type DashboardOverview, type WorkspaceWithMembership } from "@thcpn/api";
import { I18nProvider, useLocale } from "@thcpn/i18n";
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
function Controls() {
  const { setCurrentId } = useWorkspace();
  const { locale, setLocale } = useLocale();
  useEffect(() => { if (locale !== "en-US") void setLocale("en-US"); }, [locale, setLocale]);
  return <button onClick={() => setCurrentId("grassland")}>Switch workspace</button>;
}
async function mount() {
  return render(<MemoryRouter><I18nProvider><WorkspaceProvider><Controls /><DashboardPage /></WorkspaceProvider></I18nProvider></MemoryRouter>);
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

it("distinguishes unknown, partial and zero counts without inventing a source update time", async () => {
  const data = overview();
  data.records.total = count(null, false);
  data.records.today = count(18, false);
  data.images.total = count(0);
  data.statistics_updated_at = null;
  data.devices.unknown = 2;
  data.devices.reporting = 0;
  data.attention = [];
  data.trend[0] = { date: "2026-11-02", records: null, images: 0, records_complete: false, images_complete: true };
  vi.spyOn(api, "dashboard").mockResolvedValue(data);
  const { host } = await mount();
  await eventually(() => expect(host.querySelector('[data-testid="overview-today"]')?.textContent).toBe("18"));
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("Unknown");
  expect(host.querySelector('[data-testid="overview-images"]')?.textContent).toBe("0");
  expect(host.textContent).toContain("Covers 1 of 3 devices");
  expect(host.textContent).toContain("2 unknown");
  expect(host.textContent).toContain("Statistics update time unknown");
  expect(host.textContent).not.toContain("No devices currently need attention");
  expect(host.querySelector('.overview-bar-target')?.querySelector('.overview-bar')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>(".overview-bar-target")!.focus());
  expect(host.querySelector(".overview-chart-readout")?.textContent).toContain("Unknown");
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".overview-bar-target")[1].click());
  expect(host.querySelector(".overview-chart-readout")?.textContent).toContain("18");
  await act(async () => button(host, "Data table").click());
  const firstRow = host.querySelector("tbody tr");
  expect(firstRow?.textContent).toContain("Unknown");
  expect(firstRow?.textContent).toContain("0Complete");
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
  expect(host.querySelector('[data-testid="overview-trend-frame"]')).toBe(frame);
  expect(host.querySelectorAll(".overview-bar-target")).toHaveLength(3);
  await act(async () => reload.resolve({ ...data, days: 30 }));
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
  expect(host.querySelector('[data-testid="overview-records"]')?.textContent).toBe("Unknown");
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
