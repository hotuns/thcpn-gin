export type AdminEdition = {
  readonly lite: boolean;
  readonly platformHomePath: "/atlas" | "/dashboard";
  readonly allowedNavKeys: ReadonlySet<string>;
  readonly showVendorDossier: boolean;
  readonly showClaimCredential: boolean;
  readonly showWorkspaceAssignment: boolean;
  readonly showLoginVisualSettings: boolean;
  readonly showCommercialOverview: boolean;
  readonly showBillingSettings: boolean;
};

const FULL_ADMIN_NAV_KEYS = [
  "overview",
  "devices",
  "deviceInspection",
  "deviceMap",
  "exports",
  "firmware",
  "sources",
  "sensors",
  "sensorsV2",
  "metadata",
  "processingPlans",
  "users",
  "workspaces",
  "demoAccounts",
  "announcements",
  "billing",
  "logs",
  "administrators",
  "settings",
] as const;

const LITE_ADMIN_NAV_KEYS = [
  "overview",
  "devices",
  "deviceInspection",
  "deviceMap",
  "exports",
  "firmware",
  "sources",
  "sensors",
  "sensorsV2",
  "users",
  "logs",
  "administrators",
  "settings",
] as const;

export function createAdminEdition(lite: boolean): AdminEdition {
  if (!lite) {
    return {
      lite: false,
      platformHomePath: "/dashboard",
      allowedNavKeys: new Set(FULL_ADMIN_NAV_KEYS),
      showVendorDossier: true,
      showClaimCredential: true,
      showWorkspaceAssignment: true,
      showLoginVisualSettings: true,
      showCommercialOverview: true,
      showBillingSettings: true,
    };
  }
  return {
    lite: true,
    platformHomePath: "/atlas",
    allowedNavKeys: new Set(LITE_ADMIN_NAV_KEYS),
    showVendorDossier: false,
    showClaimCredential: false,
    showWorkspaceAssignment: false,
    showLoginVisualSettings: false,
    showCommercialOverview: false,
    showBillingSettings: false,
  };
}

export const adminEdition: AdminEdition = createAdminEdition(
  import.meta.env.VITE_LITE_MODE === "true",
);
