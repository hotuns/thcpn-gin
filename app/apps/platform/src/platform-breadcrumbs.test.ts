import { describe, expect, it } from "vitest";
import { platformBreadcrumbs } from "./platform-breadcrumbs";

describe("platformBreadcrumbs", () => {
  it("uses page hierarchy instead of workspace context", () => {
    expect(platformBreadcrumbs("/devices/device-1")).toEqual([
      { key: "overview", to: "/dashboard" },
      { key: "devices", to: "/devices" },
      { key: "deviceDetails" },
    ]);
  });

  it("provides a navigable parent for nested editor and task routes", () => {
    expect(platformBreadcrumbs("/datasets/data-1/edit").at(-2)).toEqual({ key: "datasets", to: "/datasets" });
    expect(platformBreadcrumbs("/processing/task-1").at(-2)).toEqual({ key: "processing", to: "/processing" });
  });
});
