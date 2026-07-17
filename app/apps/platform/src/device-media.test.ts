// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Device } from "@thcpn/api";
import { isCameraDevice, tokenFromActionUrl } from "./device-media";

describe("device media security helpers", () => {
  it("extracts only backend-issued action tokens", () => {
    expect(tokenFromActionUrl("/api/v1/media/download?token=signed-123")).toBe("signed-123");
    expect(tokenFromActionUrl("not a valid url?token=x")).toBe("x");
    expect(tokenFromActionUrl(undefined)).toBe("");
  });

  it("detects camera assets from topology or capabilities", () => {
    const base: Device = { id: "d1", serial_no: "s1", name: "Camera", status: "active", lifecycle_status: "online", device_type: "standalone", topology_role: "standalone", child_count: 0, capabilities: [], created_at: "", updated_at: "" };
    expect(isCameraDevice({ ...base, device_type: "camera" })).toBe(true);
    expect(isCameraDevice({ ...base, capabilities: ["media.live_view"] })).toBe(true);
    expect(isCameraDevice(base)).toBe(false);
  });
});
