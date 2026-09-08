import { describe, expect, it } from "vitest";
import type { Device } from "@thcpn/api";
import { deviceOptionCategory, filterDeviceOptions } from "./device-combobox";

const device = (id: string, name: string, role: Device["topology_role"], serial = "") => ({
  id,
  name,
  serial_no: serial,
  topology_role: role,
  device_type: role,
}) as Device;

const devices = [
  device("gateway-id", "林区组网站", "gateway", "GW-01"),
  device("node-id", "土壤节点", "gateway_node", "NODE-01"),
  device("camera-id", "林区相机", "camera", "CAM-01"),
  device("station-id", "生态标准站", "standalone", "ST-01"),
];

describe("device combobox categories", () => {
  it("maps every device role to its user-facing category", () => {
    expect(devices.map(deviceOptionCategory)).toEqual([
      "gateway",
      "gateway_node",
      "camera",
      "standalone",
    ]);
  });

  it("filters by category and searches name, serial number, or id", () => {
    expect(filterDeviceOptions(devices, "", "gateway_node").map((item) => item.id)).toEqual(["node-id"]);
    expect(filterDeviceOptions(devices, "CAM-01").map((item) => item.id)).toEqual(["camera-id"]);
    expect(filterDeviceOptions(devices, "station-id").map((item) => item.id)).toEqual(["station-id"]);
  });

  it("searches device tags", () => {
    expect(filterDeviceOptions(devices, "高寒", "all", new Map([["station-id", ["高寒生态"]]])).map((item) => item.id)).toEqual(["station-id"]);
  });
});
