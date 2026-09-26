// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  type AtlasView,
  type DataStream,
  type DeviceMapItem,
  type GatewayNode,
} from "@thcpn/api";
import { AtlasDevice } from "./atlas-device";
import { AtlasMedia } from "./atlas-media";
import { AtlasPage } from "./atlas-page";
import { reportingCounts } from "./atlas-health";
import { atlasTemplate, atlasTemplates } from "./atlas-templates";
import {
  defaultAtlasConfig,
  filterDevices,
  located,
  seriesSummary,
  streamCatalog,
  timeRange,
  validRange,
} from "./atlas-model";

vi.mock("@thcpn/workspace", () => ({
  useWorkspace: () => ({
    currentId: "workspace",
    current: { name: "Test workspace" },
  }),
  workspaceQueryKey: (id: string, ...parts: string[]) => [
    "workspace",
    id,
    ...parts,
  ],
}));
vi.mock("./atlas-map", () => ({ AtlasMap: () => <div>Map</div> }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AreaChart: () => <div>Chart</div>,
  Area: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.spyOn(api.devices, "runtime").mockResolvedValue({
    items: [],
    failures: [],
    refreshed_at: "",
  });
});
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
async function mount(view: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/atlas"]}>{view}</MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await settle();
  await settle();
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});
const device: DeviceMapItem = {
  device_id: "device",
  name: "Forest station",
  serial_no: "SN01",
  device_type: "standard",
  status: "active",
  location_source: "unconfigured",
  child_count: 0,
  environment: { observation_objects: [], purposes: [], research_tags: [] },
};
const stream = (id: string): DataStream => ({
  id,
  device_id: "device",
  code: id,
  name: id,
  type: "telemetry",
  status: "active",
  unit: "V",
  computed: false,
  created_by: "user",
  created_at: "",
  updated_at: "",
});
const points = [
  { ts: "2026-09-25T00:00:00Z", value: 1, quality: "good" },
  { ts: "2026-09-24T00:00:00Z", value: 0, quality: "good" },
];
const savedView: AtlasView = {
  id: "view",
  workspace_id: "workspace",
  name: "Saved atlas",
  template_code: "atlas-tech",
  template_version: 1,
  template_name: "Atlas",
  component_key: "atlas-tech",
  config: { ...defaultAtlasConfig, presentation: "panorama" as const },
  status: "active",
  created_by: "user",
  created_at: "",
  updated_at: "",
};
function AtlasRoutes() {
  return (
    <Routes>
      <Route path="/atlas" element={<AtlasPage />} />
      <Route path="/atlas/:id" element={<AtlasPage />} />
    </Routes>
  );
}

describe("atlas model", () => {
  it("counts reporting freshness without treating missing data or failures as device faults", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const record = (id: string, sampled_at: string) => ({
      device_id: id,
      external_device_id: 1,
      source_device: { id: 1, name: id },
      attributes: {
        battery: { raw_value: "12", sampled_at, source_table: "test" },
      },
      refreshed_at: "",
    });
    expect(
      reportingCounts(
        ["ok", "late", "missing", "failed", "future"],
        {
          items: [
            record("ok", "2026-09-25T12:00:00Z"),
            record("late", "2026-09-25T11:59:59Z"),
            record("failed", "2026-09-26T11:00:00Z"),
            record("future", "2026-09-27T12:00:00Z"),
          ],
          failures: [{ device_id: "failed", error: "unavailable" }],
          refreshed_at: "",
        },
        now,
      ),
    ).toEqual({ total: 5, normal: 1, overdue: 1, unknown: 3 });
    expect(reportingCounts(["ok"], undefined, now)).toEqual({
      total: 1,
      normal: 0,
      overdue: 0,
      unknown: 1,
    });
  });
  it("registers only the original and panoramic templates", () => {
    expect(atlasTemplates.map((template) => template.id)).toEqual([
      "technology",
      "panorama",
    ]);
    expect(atlasTemplate("unknown").id).toBe("technology");
  });
  it("keeps unlocated devices searchable and treats zero coordinates as valid", () => {
    expect(located(device)).toBe(false);
    expect(located({ latitude: 0, longitude: 0 })).toBe(true);
    expect(located({ latitude: 91, longitude: 10 })).toBe(false);
    expect(filterDevices([device], [], "sn01", "all")).toEqual([device]);
    expect(filterDevices([device], ["another"], "", "all")).toEqual([]);
  });
  it("merges physical and virtual gateway nodes without duplicate streams", () => {
    const nodes: GatewayNode[] = [
      {
        key: "node",
        name: "Node 1",
        custom_name: "",
        can_rename: false,
        target: {
          kind: "gateway_node",
          gateway_device_id: "gateway",
          node_index: 1,
        },
        streams: [stream("a")],
      },
    ];
    const catalog = streamCatalog(
      [stream("a"), { ...stream("disabled"), status: "disabled" }],
      nodes,
    );
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ node: "Node 1", device_id: "gateway" });
  });
  it("validates ranges and orders points without mutating the API response", () => {
    const range = timeRange(24, Date.parse("2026-09-25T00:00:00Z"));
    expect(validRange(range.start, range.end)).toBe(true);
    expect(validRange(range.end, range.start)).toBe(false);
    expect(validRange("invalid", range.end)).toBe(false);
    expect(validRange("2026-01-01", "2026-03-01")).toBe(false);
    const summary = seriesSummary({
      data_stream_id: "a",
      code: "a",
      name: "a",
      points,
      source_count: 2,
      returned_count: 2,
      sampled: false,
      complete: true,
    });
    expect(summary).toMatchObject({
      min: 0,
      max: 1,
      mean: 0.5,
      latest: points[0],
    });
    expect(points[0].value).toBe(1);
    expect(seriesSummary().latest).toBeUndefined();
  });
});

describe("atlas interactions", () => {
  it("edits existing views from the home cards and keeps management controls out of the view", async () => {
    vi.spyOn(api.devices, "map").mockResolvedValue({
      items: [device],
      total: 1,
      located: 0,
      unlocated: 1,
      unclassified: 1,
    });
    vi.spyOn(api.dataStreams, "list").mockResolvedValue({ items: [] });
    vi.spyOn(api.atlas, "list").mockResolvedValue({
      items: [savedView],
      can_manage: true,
    });
    vi.spyOn(api.atlas, "get").mockResolvedValue(savedView);
    const update = vi.spyOn(api.atlas, "update").mockResolvedValue(savedView);
    const create = vi.spyOn(api.atlas, "create");
    await mount(<AtlasRoutes />);
    await act(async () =>
      (
        container.querySelector(
          ".atlas-saved-card button:last-child",
        ) as HTMLButtonElement
      ).click(),
    );
    const dialog = document.querySelector(".atlas-settings")!;
    expect(dialog.querySelector("input")?.value).toBe(savedView.name);
    await act(async () =>
      (
        dialog.querySelector(
          ".shadcn-dialog-footer button:last-child",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect(update).toHaveBeenCalledWith(
      "workspace",
      "view",
      expect.objectContaining({ config: savedView.config }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll(".atlas-header-actions button"),
    ).toHaveLength(1);
    expect(container.querySelector(".atlas-template-bar")).toBeNull();
    expect(container.querySelector(".atlas-title")?.textContent).not.toContain(
      "Test workspace",
    );
  });
  it("loads metrics in bounded pages and exposes metrics beyond the first page", async () => {
    const streams = Array.from({ length: 20 }, (_, i) =>
      stream(`metric-${i + 1}`),
    );
    vi.spyOn(api.dataStreams, "list").mockResolvedValue({ items: streams });
    const data = vi
      .spyOn(api.telemetry, "dataStream")
      .mockImplementation(async (id, input) => ({
        device_id: "device",
        start_time: input.startTime,
        end_time: input.endTime,
        limit: 5000,
        series: [
          {
            data_stream_id: id,
            code: id,
            name: id,
            points,
            source_count: 2,
            returned_count: 2,
            complete: true,
            sampled: false,
          },
        ],
      }));
    await mount(
      <AtlasDevice
        device={device}
        workspaceId="workspace"
        config={{
          ...defaultAtlasConfig,
          telemetry_stream_ids: streams.map((s) => s.id),
        }}
        onSelection={() => {}}
      />,
    );
    expect(data).toHaveBeenCalledTimes(8);
    expect(container.querySelectorAll(".atlas-metric")).toHaveLength(8);
    expect(container.querySelectorAll(".atlas-trend")).toHaveLength(4);
    const next = container.querySelector(
      ".atlas-pagination button:last-child",
    ) as HTMLButtonElement;
    await act(async () => next.click());
    await settle();
    expect(container.querySelector(".atlas-metrics")?.textContent).toContain(
      "metric-9",
    );
    expect(data).toHaveBeenCalledTimes(16);
  });
  it("paginates capture images beyond the first twelve", async () => {
    const images = vi.spyOn(api.media, "images").mockResolvedValue({
      items: [
        {
          id: "photo",
          device_id: "device",
          data_stream_id: "camera",
          captured_at: "2026-09-25T00:00:00Z",
          media_type: "image",
          preview_url: "/test-full.jpg",
          thumbnail_url: "/test-thumb.jpg",
          download_allowed: false,
          delete_allowed: false,
        },
      ],
      total: 25,
      page: 1,
      page_size: 12,
    });
    await mount(
      <AtlasMedia
        workspaceId="workspace"
        deviceId="device"
        streams={[]}
        range={timeRange(24)}
        asset={false}
      />,
    );
    expect(
      container.querySelector(".atlas-photo img")?.getAttribute("src"),
    ).toBe("/test-thumb.jpg");
    await act(async () =>
      (container.querySelector(".atlas-photo") as HTMLButtonElement).click(),
    );
    expect(document.querySelector(".PhotoView-Portal")).not.toBeNull();
    const next = container.querySelector(
      ".atlas-pagination button:last-child",
    ) as HTMLButtonElement;
    await act(async () => next.click());
    await settle();
    expect(images).toHaveBeenLastCalledWith(
      "device",
      expect.objectContaining({ page: 2, page_size: 12 }),
    );
    expect(container.querySelector(".atlas-pagination")?.textContent).toContain(
      "2 / 3",
    );
  });
  it("starts at templates, cancels without saving, retains failed drafts and opens the saved view", async () => {
    vi.spyOn(api.dataStreams, "list").mockResolvedValue({ items: [] });
    vi.spyOn(api.devices, "map").mockResolvedValue({
      items: [device],
      total: 1,
      located: 0,
      unlocated: 1,
      unclassified: 1,
    });
    vi.spyOn(api.atlas, "list").mockResolvedValue({
      items: [],
      can_manage: true,
    });
    const create = vi
      .spyOn(api.atlas, "create")
      .mockRejectedValueOnce(new Error("Save unavailable"))
      .mockResolvedValue(savedView);
    vi.spyOn(api.atlas, "get").mockResolvedValue(savedView);
    await mount(<AtlasRoutes />);
    expect(container.querySelector(".atlas-workbench")).toBeNull();
    expect(container.querySelectorAll(".atlas-home-template")).toHaveLength(2);
    const configure = container.querySelectorAll(
      ".atlas-home-template button",
    )[1] as HTMLButtonElement;
    await act(async () => configure.click());
    await act(async () =>
      (
        document.querySelector(
          ".atlas-settings .shadcn-dialog-footer button",
        ) as HTMLButtonElement
      ).click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    await act(async () => configure.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    const choices = dialog.querySelectorAll(".atlas-template-card");
    expect(choices).toHaveLength(2);
    expect(choices[1].getAttribute("aria-pressed")).toBe("true");
    await act(async () =>
      (
        dialog.querySelector(
          '.atlas-settings-scope button[role="checkbox"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const buttons = dialog.querySelectorAll(".shadcn-dialog-footer button");
    await act(async () =>
      (buttons[buttons.length - 1] as HTMLButtonElement).click(),
    );
    await settle();
    expect(
      document.querySelector('.atlas-settings [role="alert"]'),
    ).not.toBeNull();
    expect(
      dialog
        .querySelector('.atlas-settings-scope button[role="checkbox"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () =>
      (buttons[buttons.length - 1] as HTMLButtonElement).click(),
    );
    await settle();
    expect(create).toHaveBeenCalledWith(
      "workspace",
      expect.objectContaining({
        template_code: "atlas-tech",
        config: expect.objectContaining({
          layout: "balanced",
          trend_hours: 24,
          show_images: true,
          presentation: "panorama",
          device_ids: ["device"],
        }),
      }),
    );
    expect(container.querySelector(".atlas-template-panorama")).not.toBeNull();
    expect(container.querySelector(".atlas-title")?.textContent).toContain(
      "Saved atlas",
    );
  });
  it("does not expose saved-view editing without server-provided management permission", async () => {
    vi.spyOn(api.dataStreams, "list").mockResolvedValue({ items: [] });
    vi.spyOn(api.devices, "map").mockResolvedValue({
      items: [device],
      total: 1,
      located: 0,
      unlocated: 1,
      unclassified: 1,
    });
    vi.spyOn(api.atlas, "list").mockResolvedValue({
      items: [savedView],
      can_manage: false,
    });
    vi.spyOn(api.atlas, "get").mockResolvedValue(savedView);
    await mount(<AtlasRoutes />);
    const createButtons = container.querySelectorAll<HTMLButtonElement>(
      ".atlas-home-template button",
    );
    expect([...createButtons].every((button) => button.disabled)).toBe(true);
    await act(async () =>
      (
        container.querySelector(".atlas-saved-card button") as HTMLButtonElement
      ).click(),
    );
    await settle();
    await settle();
    expect(
      container.querySelectorAll(".atlas-header-actions button"),
    ).toHaveLength(1); // fullscreen only
    expect(
      container.querySelector(".atlas-device-list")?.textContent,
    ).toContain("Forest station");
    expect(container.querySelector(".atlas-template-bar")).toBeNull();
    expect(container.querySelector(".atlas-settings")).toBeNull();
    expect(
      container.querySelector(
        ".atlas-template-panorama .atlas-panorama-workbench",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".atlas-device-list")?.textContent,
    ).toContain("Forest station");
    const present = container.querySelector(
      ".atlas-header-actions > button:last-child",
    ) as HTMLButtonElement;
    await act(async () => present.click());
    expect(container.querySelector(".is-presenting")).not.toBeNull();
    expect(present.textContent).toBe("");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(container.querySelector(".is-presenting")).toBeNull();
  });
});
