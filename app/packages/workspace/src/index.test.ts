import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateNodeNames, resolveWorkspaceId, workspaceQueryKey } from "./index";

describe("Workspace isolation", () => {
  const workspaces = [{ id: "workspace-a" }, { id: "workspace-b" }];

  it("keeps a persisted workspace that is still accessible", () => {
    expect(resolveWorkspaceId("workspace-b", workspaces)).toBe("workspace-b");
  });

  it("falls back when the persisted workspace is no longer accessible", () => {
    expect(resolveWorkspaceId("removed", workspaces)).toBe("workspace-a");
    expect(resolveWorkspaceId(null, [])).toBeNull();
  });

  it("includes workspace ID in every scoped query key", () => {
    expect(workspaceQueryKey("workspace-a", "devices")).toEqual(["workspace", "workspace-a", "devices"]);
    expect(workspaceQueryKey("workspace-b", "devices")).not.toEqual(workspaceQueryKey("workspace-a", "devices"));
  });
});

it("refreshes node name projections in all workspaces without repeating telemetry", async () => {
  const client = new QueryClient();
  const projections = [workspaceQueryKey("a", "device", "gateway", "nodes"), workspaceQueryKey("b", "device", "gateway", "nodes"), ["admin", "device", "carbon", "carbon-overview"]];
  const readings = [["carbon", "id", "flux"], ["carbon", "id", "periods"], workspaceQueryKey("a", "gateway", "id", "telemetry")];
  [...projections, ...readings].forEach(key => client.setQueryData(key, {}));
  await invalidateNodeNames(client);
  projections.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
  readings.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(false));
  client.clear();
});
