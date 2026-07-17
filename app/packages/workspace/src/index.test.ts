import { describe, expect, it } from "vitest";
import { resolveWorkspaceId, workspaceQueryKey } from "./index";

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
