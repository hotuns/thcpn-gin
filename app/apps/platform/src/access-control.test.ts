import { describe, expect, it } from "vitest";
import { externalPermission, permissionsForTemplate } from "./access-control";

const templates = [
  { code: "viewer", name: "Viewer", permission_codes: ["device.view", "telemetry.query", "audit.view", "member.manage"] },
  { code: "service_engineer", name: "Service engineer", permission_codes: ["device.view", "device.operate", "service_access.use"] }
];

describe("access-control permission rules", () => {
  it("filters internal administration permissions from external grants", () => {
    expect(externalPermission("device.view")).toBe(true);
    expect(externalPermission("member.manage")).toBe(false);
    expect(externalPermission("workspace.manage")).toBe(false);
    expect(externalPermission("audit.view")).toBe(false);
  });

  it("uses the selected template as a permission prefill", () => {
    expect(permissionsForTemplate(templates, "viewer", false)).toEqual(["device.view", "telemetry.query", "audit.view", "member.manage"]);
    expect(permissionsForTemplate(templates, "viewer", true)).toEqual(["device.view", "telemetry.query"]);
    expect(permissionsForTemplate(templates, "missing", true)).toEqual([]);
  });
});
