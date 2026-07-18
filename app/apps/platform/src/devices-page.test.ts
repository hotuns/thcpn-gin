import { describe, expect, it } from "vitest";
import type { Device } from "@thcpn/api";
import {
  calibrationPayload,
  deviceCategory,
  deviceDetailTab,
  filterQuickSwitchDevices,
  firmwarePayload,
  isTopLevelDevice,
  legacyDeviceTarget,
} from "./devices-page";

describe("device workflow payloads", () => {
  it("classifies device topology for category filters", () => {
    expect(
      deviceCategory({ topology_role: "gateway", device_type: "gateway" }),
    ).toBe("gateway");
    expect(
      deviceCategory({ topology_role: "camera", device_type: "camera" }),
    ).toBe("camera");
    expect(
      deviceCategory({
        topology_role: "standalone",
        device_type: "standalone",
      }),
    ).toBe("standalone");
    expect(
      deviceCategory({
        topology_role: "gateway_node",
        device_type: "gateway_node",
      }),
    ).toBe("gateway_node");
  });

  it("keeps gateway nodes inside their gateway instead of the top-level list", () => {
    expect(
      isTopLevelDevice({
        topology_role: "gateway_node",
        device_type: "gateway_node",
      }),
    ).toBe(false);
    expect(
      isTopLevelDevice({
        topology_role: "gateway",
        device_type: "gateway",
      }),
    ).toBe(true);
  });

  it("builds calibration input with optional device parameters", () => {
    expect(calibrationPayload(" zero_point ", "{}")).toEqual({
      calibration_type: "zero_point",
    });
    expect(calibrationPayload("span", '{"reference":100}')).toEqual({
      calibration_type: "span",
      parameters: { reference: 100 },
    });
  });

  it("omits empty firmware fields", () => {
    expect(firmwarePayload(" 2.4.1 ", "", "", "")).toEqual({
      firmware_version: "2.4.1",
    });
    expect(
      firmwarePayload(
        "2.4.1",
        "s3://firmware.bin",
        "sha256:abc",
        "2026-01-02T08:00",
      ),
    ).toMatchObject({
      firmware_version: "2.4.1",
      package_uri: "s3://firmware.bin",
      checksum: "sha256:abc",
    });
  });

  it("normalizes detail tabs by device type", () => {
    expect(deviceDetailTab("data", false)).toBe("data");
    expect(deviceDetailTab("video", true)).toBe("video");
    expect(deviceDetailTab("profile", false)).toBe("profile");
    expect(deviceDetailTab("sharing", true)).toBe("sharing");
    expect(deviceDetailTab("video", false)).toBe("overview");
    expect(deviceDetailTab("unknown", true)).toBe("overview");
  });

  it("maps legacy links to data or video tabs", () => {
    const base: Device = {
      id: "device/1",
      serial_no: "s1",
      name: "Device",
      status: "active",
      lifecycle_status: "online",
      device_type: "standalone",
      topology_role: "standalone",
      child_count: 0,
      capabilities: [],
      created_at: "",
      updated_at: "",
    };
    expect(legacyDeviceTarget(base)).toBe("/devices/device%2F1?tab=data");
    expect(legacyDeviceTarget({ ...base, device_type: "camera" })).toBe(
      "/devices/device%2F1?tab=video",
    );
  });

  it("filters device switch options by name, serial number, or id", () => {
    const devices = [
      { id: "device-1", name: "平谷观测站", serial_no: "SN-001" },
      { id: "device-2", name: "海康相机", serial_no: "CAM-002" },
    ] as Device[];
    expect(filterQuickSwitchDevices(devices, "海康").map((item) => item.id)).toEqual(["device-2"]);
    expect(filterQuickSwitchDevices(devices, "SN-001").map((item) => item.id)).toEqual(["device-1"]);
    expect(filterQuickSwitchDevices(devices, "device-2").map((item) => item.id)).toEqual(["device-2"]);
  });
});
