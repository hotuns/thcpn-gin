import { describe, expect, it } from "vitest";
import {
  mfaRequiredMessage,
  demoModeFromSearch,
  platformNextPath,
  validPassword,
} from "./auth-pages";

describe("authentication form rules", () => {
  it("enforces the documented password policy", () => {
    expect(validPassword("password1")).toBe(true);
    expect(validPassword("12345678")).toBe(false);
    expect(validPassword("password")).toBe(false);
    expect(validPassword("a1".repeat(65))).toBe(false);
  });

  it("recognizes MFA challenges without showing MFA to every user", () => {
    expect(mfaRequiredMessage("TOTP code is required")).toBe(true);
    expect(mfaRequiredMessage("invalid password")).toBe(false);
  });

  it("returns authenticated users to platform routes without accepting admin or external targets", () => {
    expect(platformNextPath("/devices/device-1?tab=config")).toBe(
      "/devices/device-1?tab=config",
    );
    expect(platformNextPath("/admin/devices")).toBeNull();
    expect(platformNextPath("//example.com/devices")).toBeNull();
    expect(platformNextPath(null)).toBeNull();
  });

  it("only enables demo authentication through the explicit login switch state", () => {
    expect(demoModeFromSearch("?demo=1")).toBe(true);
    expect(demoModeFromSearch("?demo=0")).toBe(false);
    expect(demoModeFromSearch("")).toBe(false);
  });
});
