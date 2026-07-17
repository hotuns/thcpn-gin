import { describe, expect, it } from "vitest";
import { buildDatasetPayload, datasetDetailPath } from "./datasets-page";

const draft = { workspaceId: "w1", projectId: "p1", name: "  Trial A  ", description: "field data", dataType: "telemetry", startTime: "2026-01-01T08:00", endTime: "2026-01-02T08:00", sources: [{ source_type: "device" as const, source_id: "d1" }, { source_type: "data_stream" as const, source_id: "s1" }], status: "active" };

describe("dataset payload", () => {
  it("creates a contract-compliant source definition", () => {
    expect(buildDatasetPayload(draft)).toMatchObject({ workspace_id: "w1", project_id: "p1", name: "Trial A", data_type: "telemetry", sources: [{ source_type: "device", source_id: "d1" }, { source_type: "data_stream", source_id: "s1" }] });
  });

  it("does not send immutable workspace_id during update", () => {
    const payload = buildDatasetPayload(draft, true);
    expect(payload).not.toHaveProperty("workspace_id");
    expect(payload).not.toHaveProperty("project_id");
    expect(payload).toHaveProperty("status", "active");
  });

  it("builds a refreshable dataset detail URL", () => {
    expect(datasetDetailPath("dataset/one")).toBe("/datasets/dataset%2Fone");
  });
});
