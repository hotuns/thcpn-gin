import { describe, expect, it } from "vitest";
import { createAdminEdition } from "../../apps/admin/src/edition";

describe("admin edition", () => {
  it("preserves full vendor and governance menus when lite is false", () => {
    const full = createAdminEdition(false);
    expect(full.lite).toBe(false);
    expect(full.platformHomePath).toBe("/dashboard");
    expect(full.showVendorDossier).toBe(true);
    expect(full.showClaimCredential).toBe(true);
    expect(full.showWorkspaceAssignment).toBe(true);
    expect(full.showLoginVisualSettings).toBe(true);
    expect(full.showCommercialOverview).toBe(true);
    expect(full.showBillingSettings).toBe(true);
    expect(full.allowedNavKeys.has("workspaces")).toBe(true);
    expect(full.allowedNavKeys.has("billing")).toBe(true);
  });

  it("removes vendor-only and multi-tenant menus while keeping firmware and inspection in lite mode", () => {
    const lite = createAdminEdition(true);
    expect(lite.lite).toBe(true);
    expect(lite.platformHomePath).toBe("/atlas");
    expect(lite.showVendorDossier).toBe(false);
    expect(lite.showClaimCredential).toBe(false);
    expect(lite.showWorkspaceAssignment).toBe(false);
    expect(lite.showLoginVisualSettings).toBe(false);
    expect(lite.showCommercialOverview).toBe(false);
    expect(lite.showBillingSettings).toBe(false);

    // Explicitly kept per user requirement
    expect(lite.allowedNavKeys.has("firmware")).toBe(true);
    expect(lite.allowedNavKeys.has("deviceInspection")).toBe(true);
    expect(lite.allowedNavKeys.has("sources")).toBe(true);
    expect(lite.allowedNavKeys.has("sensors")).toBe(true);
    expect(lite.allowedNavKeys.has("sensorsV2")).toBe(true);

    // Removed multi-tenant / vendor-only entries
    expect(lite.allowedNavKeys.has("workspaces")).toBe(false);
    expect(lite.allowedNavKeys.has("demoAccounts")).toBe(false);
    expect(lite.allowedNavKeys.has("announcements")).toBe(false);
    expect(lite.allowedNavKeys.has("billing")).toBe(false);
    expect(lite.allowedNavKeys.has("metadata")).toBe(false);
    expect(lite.allowedNavKeys.has("processingPlans")).toBe(false);
  });
});
