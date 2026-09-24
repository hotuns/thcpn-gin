import { describe, expect, it } from "vitest";
import type { Device } from "@thcpn/api";
import {
  calibrationPayload,
  deviceCategory,
  deviceDetailTab,
  filterQuickSwitchDevices,
  firmwarePayload,
  inferBatteryReading,
  inferSignalReading,
  leadAcidBatteryLevel,
  csqSignalBars,
  isTopLevelDevice,
  legacyDeviceTarget,
  matchesDeviceType,
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

  it("filters devices by the same taxonomy type used on the device map", () => {
    expect(matchesDeviceType("", undefined)).toBe(true);
    expect(matchesDeviceType("forest", { id: "forest" })).toBe(true);
    expect(matchesDeviceType("forest", { id: "wetland" })).toBe(false);
    expect(matchesDeviceType("forest", undefined)).toBe(false);
  });

  it("maps CSQ values to signal bars and leaves unknown values distinct", () => {
    for (const [value, bars] of [[0, 0], [1, 1], [9, 1], [10, 2], [14, 2], [15, 3], [19, 3], [20, 4], [31, 4]]) expect(csqSignalBars(value)).toBe(bars);
    for (const value of [null, 99, -1, 32, NaN, 1.5]) expect(csqSignalBars(value)).toBeNull();
  });
  it("treats standard station CSQ 99 as unknown rather than 99 percent", () => {
    expect(inferSignalReading(99, true)).toMatchObject({ level: "unknown", valueLabel: "未知" });
    expect(inferSignalReading(31, true)).toMatchObject({ level: "good", valueLabel: "CSQ 31" });
    expect(inferSignalReading(0, true)).toMatchObject({ level: "critical", valueLabel: "CSQ 0" });
    for (const value of [null, -1, 32, 100, NaN, Infinity, 15.5]) expect(inferSignalReading(value, true).level).toBe("unknown");
  });

  it("preserves other device signal interpretation", () => {
    expect(inferSignalReading(99)).toMatchObject({
      level: "good",
      valueLabel: "99%",
    });
    expect(inferSignalReading(35).level).toBe("low");
    expect(inferSignalReading(null).level).toBe("unknown");
  });

  it("grades standard station lead-acid voltage without treating it as a percentage", () => {
    expect(leadAcidBatteryLevel(11.3)).toBe("critical");
    expect(leadAcidBatteryLevel(11.31)).toBe("low");
    expect(leadAcidBatteryLevel(11.99)).toBe("low");
    expect(leadAcidBatteryLevel(12)).toBe("fair");
    expect(leadAcidBatteryLevel(12.59)).toBe("fair");
    expect(leadAcidBatteryLevel(12.6)).toBe("good");
    expect(inferBatteryReading(14, true)).toMatchObject({ level: "good", valueLabel: "14.00V" });
    for (const value of [null, 0, -1, NaN, Infinity]) expect(leadAcidBatteryLevel(value)).toBe("unknown");
  });
  it("infers common battery voltage and percentage values", () => {
    expect(inferBatteryReading(12, false, true)).toMatchObject({ level: "unknown", valueLabel: "12.00V" });
    expect(inferBatteryReading(3.6, false, true)).toMatchObject({ level: "unknown", valueLabel: "3.60V" });
    expect(inferBatteryReading(6, false, true).valueLabel).toBe("6.00V");
    expect(inferBatteryReading(12.91)).toMatchObject({
      level: "good",
      valueLabel: "12.9V",
    });
    expect(inferBatteryReading(3.4).level).toBe("low");
    expect(inferBatteryReading(25)).toMatchObject({
      level: "low",
      valueLabel: "25%",
    });
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
    expect(deviceDetailTab("profile", true)).toBe("profile");
    expect(deviceDetailTab("activity", true)).toBe("activity");
    expect(deviceDetailTab("overview", true)).toBe("video");
    expect(deviceDetailTab("config", true)).toBe("video");
    expect(deviceDetailTab("sharing", true)).toBe("video");
    expect(deviceDetailTab("video", false)).toBe("overview");
    expect(deviceDetailTab("unknown", true)).toBe("video");
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
