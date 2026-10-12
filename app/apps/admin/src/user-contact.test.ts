import { describe, expect, it } from "vitest";
import { validateUserContact } from "./user-contact";

describe("admin user contact requirements", () => {
  it("requires at least one nonblank contact", () => {
    expect(validateUserContact("phone", "", " ")).toBeTruthy();
    expect(validateUserContact("email", undefined, "")).toBeTruthy();
  });
  it("allows phone-only, email-only and both", () => {
    expect(validateUserContact("phone", "10000000000", "")).toBeUndefined();
    expect(validateUserContact("email", "", "10000000000")).toBeUndefined();
    expect(validateUserContact("email", " test@user.com ", "")).toBeUndefined();
    expect(validateUserContact("phone", "", "test@user.com")).toBeUndefined();
    expect(validateUserContact("phone", "+86 138-0000-0000", "test@user.com")).toBeUndefined();
  });
  it("rejects invalid provided contacts even when the other is valid", () => {
    expect(validateUserContact("email", "invalid", "10000000000")).toBeTruthy();
    expect(validateUserContact("phone", "abc", "test@user.com")).toBeTruthy();
  });
});
