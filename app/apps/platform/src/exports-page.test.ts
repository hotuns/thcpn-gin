import { describe, expect, it } from "vitest";
import { buildBatchExportPayload, buildExportPayload, canDownloadExport, exportTypesFor } from "./exports-page";

const draft = { resourceType: "device" as const, resourceId: "d1", exportType: "telemetry_csv", startTime: "2026-01-01T08:00", endTime: "2026-01-02T08:00", limit: 1000, mediaType: "", expiresAt: "" };

describe("export rules", () => {
  it("preserves images-only, data-only and combined ZIP choices", () => {
    for (const system of ["standard", "group"] as const) {
      for (const [data, images] of [[false,true],[true,false],[true,true]]) {
        const payload=buildBatchExportPayload(system,["d1"],draft.startTime,draft.endTime,images,system==="group"?{id:"g1",name:"Gateway"}:undefined,data);
        expect(payload.request_config).toMatchObject({include_data:data,include_images:images});
      }
    }
  });
  it("limits formats by resource type", () => {
    expect(exportTypesFor("dataset")).toEqual(["dataset_zip"]);
    expect(exportTypesFor("media")).toEqual(["media_zip"]);
    expect(exportTypesFor("device")).toContain("telemetry_excel");
  });

  it("includes time range for telemetry and omits it for dataset zip", () => {
    expect(buildExportPayload(draft)).toMatchObject({ resource_type: "device", resource_id: "d1", export_type: "telemetry_csv", limit: 1000 });
    const dataset = buildExportPayload({ ...draft, resourceType: "dataset", resourceId: "ds1", exportType: "dataset_zip" });
    expect(dataset).not.toHaveProperty("start_time");
    expect(dataset).not.toHaveProperty("limit");
  });

  it("only downloads successful unexpired jobs", () => {
    expect(canDownloadExport({ status: "success", expires_at: "2099-01-01T00:00:00Z" }, Date.parse("2026-01-01"))).toBe(true);
    expect(canDownloadExport({ status: "running", expires_at: "2099-01-01T00:00:00Z" }, Date.parse("2026-01-01"))).toBe(false);
    expect(canDownloadExport({ status: "success", expires_at: "2025-01-01T00:00:00Z" }, Date.parse("2026-01-01"))).toBe(false);
  });
});
