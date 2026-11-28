import { describe, expect, it } from "vitest";
import { createPlatformEdition } from "../../apps/platform/src/app/edition";
import { deviceDetailTab } from "../../apps/platform/src/features/devices/device-model";

describe("platform edition", () => {
  it("preserves full console routes and features when lite is false", () => {
    const full = createPlatformEdition(false);
    expect(full.lite).toBe(false);
    expect(full.homePath).toBe("/dashboard");
    expect(full.showWorkspaceSwitcher).toBe(true);
    expect(full.showAlerts).toBe(true);
    expect(full.showDeviceClaim).toBe(true);
    expect(full.showSharing).toBe(true);
    expect(full.showSelfRegister).toBe(true);
    expect(full.allowedNavKeys.has("workspaces")).toBe(true);
    expect(full.allowedNavKeys.has("settings")).toBe(false);
    expect(deviceDetailTab("sharing", false, false, full.allowedDeviceTabs)).toBe("sharing");
    expect(deviceDetailTab("activity", true, false, full.allowedDeviceTabs)).toBe("activity");
  });

  it("restricts navigation, login, and device tabs in lite console mode", () => {
    const lite = createPlatformEdition(true);
    expect(lite.lite).toBe(true);
    expect(lite.homePath).toBe("/atlas");
    expect(lite.showWorkspaceSwitcher).toBe(false);
    expect(lite.showNotifications).toBe(false);
    expect(lite.showOnboarding).toBe(false);
    expect(lite.showSelfRegister).toBe(false);
    expect(lite.showSmsLogin).toBe(false);
    expect(lite.showDemoLogin).toBe(false);
    expect(lite.showLoginVisuals).toBe(false);
    expect(lite.showAlerts).toBe(false);
    expect(lite.showDeviceClaim).toBe(false);
    expect(lite.showSharing).toBe(false);
    expect(lite.showDeviceUnbind).toBe(false);
    expect(lite.showDigitalPlot).toBe(false);
    expect(lite.settingsResourcesOnly).toBe(true);
    expect(lite.showEmailVerification).toBe(false);

    expect(Array.from(lite.allowedNavKeys)).toEqual([
      "wallboards",
      "devices",
      "deviceMap",
      "exports",
      "settings",
    ]);
    expect(lite.allowedRouteKeys.has("datasets")).toBe(false);
    expect(lite.allowedRouteKeys.has("processing")).toBe(false);
    expect(lite.allowedRouteKeys.has("alerts")).toBe(false);
    expect(lite.allowedRouteKeys.has("workspaces")).toBe(false);

    // Keeps config tab for sampling/sensor editing, drops sharing & activity
    expect(deviceDetailTab("config", false, false, lite.allowedDeviceTabs)).toBe("config");
    expect(deviceDetailTab("sharing", false, false, lite.allowedDeviceTabs)).toBe("overview");
    expect(deviceDetailTab("activity", false, false, lite.allowedDeviceTabs)).toBe("overview");
    expect(deviceDetailTab("activity", true, false, lite.allowedDeviceTabs)).toBe("video");
  });
});
