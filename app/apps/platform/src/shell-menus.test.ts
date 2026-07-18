import { describe, expect, it } from "vitest";
import type { AccessibleWorkspace } from "@thcpn/api";
import { canManageWorkspace, filterWorkspaces } from "./shell-menus";

const workspace = (
  id: string,
  name: string,
  role: string,
): AccessibleWorkspace =>
  ({
    id,
    name,
    type: "organization",
    owner_user_id: "00000000-0000-0000-0000-000000000001",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    membership: {
      id: `membership-${id}`,
      status: "active",
      joined_at: "2026-01-01T00:00:00Z",
      scope_type: "workspace",
      scope_id: id,
      role: { id: `role-${role}`, code: role, name: role },
    },
  }) as AccessibleWorkspace;

describe("workspace shell menu helpers", () => {
  const items = [
    workspace("workspace-a", "森林观测", "owner"),
    workspace("workspace-b", "农田试验", "viewer"),
  ];

  it("searches workspace name and id", () => {
    expect(filterWorkspaces(items, "农田")).toEqual([items[1]]);
    expect(filterWorkspaces(items, "WORKSPACE-A")).toEqual([items[0]]);
  });

  it("limits management shortcuts to owners and admins", () => {
    expect(canManageWorkspace(items[0])).toBe(true);
    expect(canManageWorkspace(workspace("workspace-c", "实验室", "admin"))).toBe(true);
    expect(canManageWorkspace(items[1])).toBe(false);
  });
});
