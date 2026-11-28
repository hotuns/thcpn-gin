export type PlatformEdition = {
  readonly lite: boolean;
  readonly homePath: "/atlas" | "/dashboard";
  readonly allowedRouteKeys: ReadonlySet<string>;
  readonly allowedNavKeys: ReadonlySet<string>;
  readonly allowedDeviceTabs: ReadonlySet<string>;
  readonly showWorkspaceSwitcher: boolean;
  readonly showNotifications: boolean;
  readonly showOnboarding: boolean;
  readonly showSelfRegister: boolean;
  readonly showSmsLogin: boolean;
  readonly showDemoLogin: boolean;
  readonly showLoginVisuals: boolean;
  readonly showAlerts: boolean;
  readonly showDeviceClaim: boolean;
  readonly showSharing: boolean;
  readonly showDeviceUnbind: boolean;
  readonly showDigitalPlot: boolean;
  readonly settingsResourcesOnly: boolean;
  readonly showEmailVerification: boolean;
};

const FULL_ROUTE_KEYS = [
  "overview",
  "dataHub",
  "more",
  "devices",
  "deviceDetails",
  "claimDevice",
  "deviceMap",
  "alerts",
  "compare",
  "datasets",
  "createDataset",
  "editDataset",
  "datasetDetails",
  "processing",
  "createProcessing",
  "processingDetails",
  "exports",
  "createExport",
  "wallboards",
  "digitalPlot",
  "atlasView",
  "workspaces",
  "settings",
  "subscription",
  "notifications",
  "account",
] as const;

const LITE_ROUTE_KEYS = [
  "wallboards",
  "atlasView",
  "devices",
  "deviceDetails",
  "deviceMap",
  "exports",
  "createExport",
  "settings",
  "account",
  "more",
  "dataHub",
] as const;

const FULL_NAV_KEYS = [
  "overview",
  "devices",
  "deviceMap",
  "alerts",
  "compare",
  "datasets",
  "processing",
  "exports",
  "wallboards",
  "workspaces",
  "subscription",
] as const;

const LITE_NAV_KEYS = [
  "wallboards",
  "devices",
  "deviceMap",
  "exports",
  "settings",
] as const;

const FULL_DEVICE_TABS = [
  "overview",
  "data",
  "video",
  "profile",
  "config",
  "sharing",
  "activity",
] as const;

const LITE_DEVICE_TABS = [
  "overview",
  "data",
  "video",
  "profile",
  "config",
] as const;

export function createPlatformEdition(lite: boolean): PlatformEdition {
  if (!lite) {
    return {
      lite: false,
      homePath: "/dashboard",
      allowedRouteKeys: new Set(FULL_ROUTE_KEYS),
      allowedNavKeys: new Set(FULL_NAV_KEYS),
      allowedDeviceTabs: new Set(FULL_DEVICE_TABS),
      showWorkspaceSwitcher: true,
      showNotifications: true,
      showOnboarding: true,
      showSelfRegister: true,
      showSmsLogin: true,
      showDemoLogin: true,
      showLoginVisuals: true,
      showAlerts: true,
      showDeviceClaim: true,
      showSharing: true,
      showDeviceUnbind: true,
      showDigitalPlot: true,
      settingsResourcesOnly: false,
      showEmailVerification: true,
    };
  }
  return {
    lite: true,
    homePath: "/atlas",
    allowedRouteKeys: new Set(LITE_ROUTE_KEYS),
    allowedNavKeys: new Set(LITE_NAV_KEYS),
    allowedDeviceTabs: new Set(LITE_DEVICE_TABS),
    showWorkspaceSwitcher: false,
    showNotifications: false,
    showOnboarding: false,
    showSelfRegister: false,
    showSmsLogin: false,
    showDemoLogin: false,
    showLoginVisuals: false,
    showAlerts: false,
    showDeviceClaim: false,
    showSharing: false,
    showDeviceUnbind: false,
    showDigitalPlot: false,
    settingsResourcesOnly: true,
    showEmailVerification: false,
  };
}

export const platformEdition: PlatformEdition = createPlatformEdition(
  import.meta.env.VITE_LITE_MODE === "true",
);
