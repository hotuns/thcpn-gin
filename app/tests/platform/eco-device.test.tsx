import { act, useState } from "react";
import { expect, it, vi } from "vitest";
import { api, type DataStream, type DeviceMapItem } from "@thcpn/api";
import { EcoDeviceInspector } from "../../apps/platform/src/features/atlas/eco-device";
import { AtlasFilmstrip } from "../../apps/platform/src/features/atlas/atlas-filmstrip";
import { render, eventually } from "../render";

vi.mock("@thcpn/auth", () => ({ useAuth: () => ({ user: { id: "observer" } }) }));

const stamp = "2026-11-03T00:00:00Z";
const metrics: DataStream[] = [
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `stream${index}`,
    name: `指标${index}`,
    unit: index === 0 ? "°C" : "%",
    code: `metric${index}`,
    type: "telemetry" as const,
    status: "active" as const,
    device_id: "station",
    computed: false,
    created_by: "observer",
    created_at: stamp,
    updated_at: stamp,
  })),
  {
    id: "battery",
    name: "电池电压",
    unit: "V",
    code: "battery",
    purpose: "device_status",
    type: "telemetry",
    status: "active",
    device_id: "station",
    computed: false,
    created_by: "observer",
    created_at: stamp,
    updated_at: stamp,
  },
];

const device: DeviceMapItem = {
  device_id: "station",
  name: "青山标准站",
  asset_no: "ST001",
  device_type: "station",
  status: "active",
  location_source: "none",
  child_count: 0,
  environment: {},
};

it("shows pinned spotlight cards, all grouped compact metrics with inline pinning, and switches into full-height multi-metric trends", async () => {
  localStorage.clear();
  vi.spyOn(api.dataStreams, "list").mockResolvedValue({ items: metrics });
  vi.spyOn(api.telemetry, "dataStream").mockResolvedValue({
    device_id: "station",
    start_time: stamp,
    end_time: stamp,
    limit: 1,
    series: [],
  });

  const { host } = await render(
    <EcoDeviceInspector
      device={device}
      workspaceId="forest"
      config={{
        trend_hours: 24,
        layout: "balanced",
        presentation: "deep-blue",
        show_trends: true,
        show_images: false,
        metric_defaults: { "device:station": ["metric0", "metric1"] },
      }}
    />,
  );

  // Readings tab renders 2 pinned cards + all 7 metrics in grouped compact list (no legacy all-metrics popover button)
  await eventually(() => expect(host.querySelectorAll(".eco-observation-row")).toHaveLength(2));
  expect(host.querySelector(".eco-all-metrics")).toBeNull();
  expect(host.querySelectorAll(".obs-compact-row")).toHaveLength(7);
  expect(host.querySelectorAll(".obs-metric-group")).toHaveLength(2);
  await eventually(() => expect(api.telemetry.dataStream).toHaveBeenCalledTimes(7));

  // Inline pin adds metric2 to spotlight cards without opening modal
  const pinMetric2 = host.querySelector<HTMLButtonElement>('button[aria-label="关注 指标2"]')!;
  await act(async () => pinMetric2.click());
  expect(host.querySelectorAll(".eco-observation-row")).toHaveLength(3);

  // Clicking a compact row switches to Trends tab focused on that metric
  const metric5Main = Array.from(host.querySelectorAll<HTMLButtonElement>(".obs-compact-main")).find((el) =>
    el.textContent?.includes("指标5"),
  )!;
  await act(async () => metric5Main.click());

  expect(host.querySelectorAll(".eco-trend-viewer")).toHaveLength(1);
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="趋势指标"]')?.value).toBe("stream5");
  expect(host.querySelector(".eco-trend-pager span")?.textContent).toBe("6 / 7");
  expect(host.querySelector(".eco-trend-viewer .eco-section-heading > span")?.textContent).toBe("%");

  // Overlay a second metric in Trends tab
  const compareSelect = host.querySelector<HTMLSelectElement>('select[aria-label="叠加对比指标"]')!;
  await act(async () => {
    compareSelect.value = "stream0";
    compareSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelectorAll(".obs-compare-chip")).toHaveLength(2);
  expect(host.querySelector(".eco-panel-title")?.textContent).toBe("设备采集数据");
  expect(host.querySelectorAll(".eco-time-pills button")).toHaveLength(3);
});

it("renders bottom imagery filmstrip collapsed by default, expands into horizontal strip, and opens fullscreen gallery", async () => {
  vi.spyOn(api.dataStreams, "list").mockResolvedValue({
    items: [
      {
        id: "cam1",
        name: "根系",
        unit: "",
        code: "cam1",
        type: "image",
        status: "active",
        device_id: "station",
        computed: false,
        created_by: "observer",
        created_at: stamp,
        updated_at: stamp,
      },
    ],
  });
  const images = vi.spyOn(api.media, "images").mockResolvedValue({
    items: Array.from({ length: 4 }, (_, index) => ({
      id: `photo-${index}`,
      device_id: "station",
      data_stream_id: "cam1",
      captured_at: stamp,
      media_type: "image",
      preview_url: `/photo-${index}.jpg`,
      thumbnail_url: `/thumb-${index}.jpg`,
      download_allowed: false,
      delete_allowed: false,
    })),
    total: 16,
    page: 1,
    page_size: 20,
  });
  vi.spyOn(api.devices, "profile").mockResolvedValue({
    device_id: "station",
    location_source: "none",
    images: [],
    can_configure: false,
    can_manage_placement: false,
  });

  function FilmstripHost() {
    const [open, setOpen] = useState(false);
    return (
      <AtlasFilmstrip
        workspaceId="forest"
        device={device}
        selectedNodeKey="gateway"
        hours={24}
        open={open}
        onOpenChange={setOpen}
        hudCollapsed={false}
        motionEnabled={false}
      />
    );
  }

  const { host } = await render(<FilmstripHost />);

  await eventually(() =>
    expect(host.querySelector(".obs-filmstrip-trigger")?.textContent).toContain("影像 · 16"),
  );
  await act(async () => host.querySelector<HTMLButtonElement>(".obs-filmstrip-trigger")!.click());

  await eventually(() => expect(host.querySelectorAll(".obs-filmstrip-thumb")).toHaveLength(4));
  expect(host.querySelector(".obs-filmstrip-count")?.textContent).toBe("共 16 张");

  const viewAllBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === "查看全部",
  )!;
  await act(async () => viewAllBtn.click());

  const gallery = document.querySelector<HTMLElement>(".eco-gallery")!;
  expect(gallery).toBeTruthy();
  expect(gallery.querySelector('[aria-pressed="true"]')?.textContent).toBe("采集图片");
  expect(gallery.textContent).toContain("资产照片");
  await eventually(() =>
    expect(images).toHaveBeenCalledWith("station", expect.objectContaining({ page_size: 12 })),
  );
});
