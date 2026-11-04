import { expect, it, vi } from "vitest";
import { api, type DataStream } from "@thcpn/api";
import { AtlasMedia } from "../../apps/platform/src/features/atlas/atlas-media";
import { render, eventually } from "../render";
const range = { start: "2026-11-02T00:00:00Z", end: "2026-11-03T00:00:00Z" };
const stream: DataStream = { id: "node-camera", code: "camera", name: "林冠相机", type: "image", status: "active", device_id: "gateway", computed: false, created_by: "observer", created_at: range.start, updated_at: range.end };
function mockMedia() {
  const all = vi.spyOn(api.media, "images").mockResolvedValue({ items: [], page: 1, page_size: 2, total: 0 });
  const camera = vi.spyOn(api.media, "dataStream").mockResolvedValue({ items: [], page: 1, page_size: 2, total: 0 });
  const profile = vi.spyOn(api.devices, "profile").mockResolvedValue({ device_id: "gateway", location_source: "none", images: [], can_configure: false, can_manage_placement: false });
  return { all, camera, profile };
}
it("queries only the selected V2 node camera, and keeps an empty camera selector accessible", async () => {
  const { all, camera, profile } = mockMedia();
  const availability = vi.fn();
  await render(<AtlasMedia workspaceId="forest" deviceId="gateway" assetDeviceId="gateway" streams={[stream]} range={range} asset={false} restrictToStreams onAvailability={availability} />);
  await eventually(() => expect(camera).toHaveBeenCalledWith("node-camera", expect.anything()));
  expect(all).not.toHaveBeenCalled();
  expect(profile).toHaveBeenCalledWith("gateway");
  await eventually(() => expect(availability).toHaveBeenLastCalledWith(true));
});
it("never requests gateway-wide images when the selected V2 node has no image streams", async () => {
  const { all, camera, profile } = mockMedia();
  const availability = vi.fn();
  await render(<AtlasMedia workspaceId="forest" deviceId="gateway" assetDeviceId="gateway" streams={[]} range={range} asset={false} restrictToStreams onAvailability={availability} />);
  await eventually(() => expect(availability).toHaveBeenLastCalledWith(false));
  expect(all).not.toHaveBeenCalled();
  expect(camera).not.toHaveBeenCalled();
  expect(profile).toHaveBeenCalledWith("gateway");
});
it("retains the existing all-camera request for a standalone device", async () => {
  const { all, camera } = mockMedia();
  const availability = vi.fn();
  await render(<AtlasMedia workspaceId="forest" deviceId="station" streams={[stream]} range={range} asset={false} onAvailability={availability} />);
  await eventually(() => expect(all).toHaveBeenCalledWith("station", expect.anything()));
  expect(camera).not.toHaveBeenCalled();
  await eventually(() => expect(availability).toHaveBeenLastCalledWith(false));
});
