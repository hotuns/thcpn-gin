import { describe, expect, it } from "vitest";
import { deviceListQueryKey } from "./device-list-cache";

describe("device list cache", () => {
  it("shares the canonical key for unfiltered device lists", () => {
    expect(deviceListQueryKey("workspace-1")).toEqual([
      "workspace",
      "workspace-1",
      "devices",
    ]);
  });

  it("isolates filtered lists without duplicating the unfiltered cache", () => {
    expect(deviceListQueryKey("workspace-1", "project-1", "site-1")).toEqual([
      "workspace",
      "workspace-1",
      "devices",
      "project-1",
      "site-1",
    ]);
  });
});
